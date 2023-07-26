const Promise = require('bluebird');
// eslint-disable-next-line import/no-extraneous-dependencies
// const _ = require('underscore');
const Deferred = require('./../../../Deferred/Deferred');
const DPTLib = require('./../../../knx/src/dptlib');
const BaseTransport = require('./index');


class KNXTransport extends BaseTransport {
    constructor(config) {
        super(config);

        if (this.debug) this.debug.info('KNXTransport.constructor');
        this.pollInterval = (config.checkInterval === undefined) ? (parseInt(process.env.POLL_INTERVAL, 10) || 0) : config.checkInterval;
        this.pollErrorTimeout = config.pollErrorTimeout || 10000;
        this.bridge = config.bridge;
        this.node = config.node;

        this.polling = false;
        this.pollStarted = false;

        this.gas = {
            read       : (config.read       || config.get) || null,             // array of GAs, read flag, react to GroupValueRead telegram coming from the bus
            transmit   : (config.transmit   || config.set) || [],               // single GA, transmit flag, will for this objects transmit any updated object value
            write      : (config.write      || config.get) || [],               // array of GAs, write flag, react to GroupValueWrite telegram coming from the bus
            update     : (config.update     || config.get) || [],               // array of GAs, update flag, react to GroupValueResponse telegram coming from the bus
            initialize : (config.initialize || config.get[0]) || []             // single GA, initialize flag, will send a GroupValueRead telegram to get initial value
        };
        this.dpt = config.dpt;

        this.handleGroupValue_Write = this.handleGroupValue_Write.bind(this);
        this.handleGroupValue_Response = this.handleGroupValue_Response.bind(this);
        this.handleGroupValue_Read = this.handleGroupValue_Read.bind(this);
        this.handleKNXConnected = this.handleKNXConnected.bind(this);
        this.handleKNXDisconnected = this.handleKNXDisconnected.bind(this);

        this.handleNewData = this.handleNewData.bind(this);
        this.settable = !!this.gas.transmit.length;
    }
    async get() {
        if (this.debug) this.debug.info('KNXTransport.get');

        const ga = this.gas.initialize;
        const connection = this.bridge.knxConnection;

        if (!connection.connected) throw new Error('Knx connection is not established.');

        return new Promise((resolve, reject) => {
            if (this.debug) this.debug.info('KNXTransport.get.1');
            connection.read(ga, this.dpt, (err, src, value) => {
                if (err) return reject(err);
                resolve({ src, value });
            });
        }).then((result) => {
            return result.value;
        }).then((resData) => {
            this.emit('connected');
            this.emit('afterGet', resData);

            return resData;
        }, (error) => {
            this.emit('disconnected');
            throw error;
        });
    }
    async set(value) {
        if (this.debug) this.debug.info('KNXTransport.set');

        const ga = this.gas.transmit;
        const connection = this.bridge.knxConnection;

        if (!connection.connected) throw new Error('KNX connection is not established.');

        const clear = () => {
            clearTimeout(timeout);
            this.off('GroupValue_Write', handleWrite);
            this.off('afterPoll', handlePoll);
        };
        const deferred = new Deferred();

        deferred.registerTimeout(10000, () => {
            clear();
            this.emit('disconnected');
        });
        // eslint-disable-next-line no-shadow
        const handleWrite = (src, dest, value) => {
            clear();
            this.emit('connected');
            this.emit('afterSet', value);
            deferred.resolve(value);
        };
        // eslint-disable-next-line no-shadow
        const handlePoll = (value) => {
            clear();
            this.emit('connected');
            this.emit('afterSet', value);
            deferred.resolve(value);
        };

        this.once('GroupValue_Write', handleWrite);
        connection.write(ga, value, this.dpt);
        const timeout = setTimeout(async () => {
            if (this.debug) this.debug.info('KNXTransport.set.setTimeout');
            this.once('afterPoll', handlePoll);
            if (!this.polling) {
                this.doPoll(0);
            }
        }, 1000);

        return deferred.promise;
    }
    async start() {
        if (this.debug) this.debug.info('KNXTransport.start');
        this.bridge.knxConnection.on('GroupValue_Read', this.handleGroupValue_Read);
        this.bridge.knxConnection.on('GroupValue_Write', this.handleGroupValue_Write);
        this.bridge.knxConnection.on('GroupValue_Response', this.handleGroupValue_Response);
        this.on('afterGet', this.handleNewData);
        this.on('afterSet', this.handleNewData);
        this.bridge.on('knx.connected', this.handleKNXConnected);
        this.bridge.on('knx.disconnected', this.handleKNXDisconnected);
        this.startPolling();
    }
    async stop() {
        if (this.debug) this.debug.info('KNXTransport.stop');
        this.bridge.knxConnection.off('GroupValue_Read', this.handleGroupValue_Read);
        this.bridge.knxConnection.off('GroupValue_Write', this.handleGroupValue_Write);
        this.bridge.knxConnection.off('GroupValue_Response', this.handleGroupValue_Response);
        this.off('afterGet', this.handleNewData);
        this.off('afterSet', this.handleNewData);
        this.bridge.off('knx.connected', this.handleKNXConnected);
        this.bridge.off('knx.disconnected', this.handleKNXDisconnected);
        this.stopPolling();
    }
    // KNX handlers start
    async handleGroupValue_Read(src, dest) {
        if (src === (this.bridge.knxConnection.options.physAddr || '15.15.15')) return;
        if (this.debug) this.debug.info('KNXTransport.event.handleGroupValue_Read.', { src, dest });
        if (!this.gas.read.includes(dest)) return;
        if (!this.data) return this.emit('error', new Error(`Receive GroupValue_Read request for GA ${dest}, but data is not yet initialized.`));
        this.emit('GroupValue_Read', src, dest);
        this.bridge.knxConnection.respond(dest, this.data, this.dpt);
    }
    async handleGroupValue_Write(src, dest, value) {
        if (!this.gas.write.includes(dest)) return;
        if (this.debug) this.debug.info('KNXTransport.event.handleGroupValue_Write.', { src, dest, value });
        try {
            value = DPTLib.fromBuffer(value, DPTLib.resolve(this.dpt));
            this.emit('GroupValue_Write', src, dest, value);
            this.handleNewData(value);
        } catch (e) {
            this.emit('error', e);
        }
    }
    async handleGroupValue_Response(src, dest, value) {
        if (!this.gas.update.includes(dest)) return;
        if (this.debug) this.debug.info('KNXTransport.event.handleGroupValue_Response.', { src, dest, value });
        try {
            value = DPTLib.fromBuffer(value, DPTLib.resolve(this.dpt));
            this.emit('GroupValue_Response', src, dest, value);
            this.handleNewData(value);
        } catch (e) {
            this.emit('error', e);
        }
    }
    // KNX handlers end

    async handleKNXConnected() {
        if (this.debug) this.debug.info('KNXTransport.event.handleKNXConnected');
        this.startPolling();
    }
    async handleKNXDisconnected() {
        if (this.debug) this.debug.info('KNXTransport.event.handleKNXDisconnected');
        this.stopPolling();
    }

    startPolling() {
        if (this.debug) this.debug.info('KNXTransport.startPolling');
        if (!this.bridge.knxConnection.connected) {
            this.debug.logger('KNX connection is not established yet.', 'warning');
            return;
        }
        this.pollStarted = true;
        this.doPoll();
    }
    doPoll(forceTimeout) {
        if (this.debug) this.debug.info('KNXTransport.doPoll', { forceTimeout, pollInterval: this.pollInterval, data: this.data });
        if (!this.pollStarted) return;
        clearTimeout(this.pollTimeout);

        if (!this.gas.initialize.length) return;
        if ((forceTimeout===undefined || forceTimeout===null) && this.pollInterval === null) return;
        if ((forceTimeout===undefined || forceTimeout===null) &&this.pollInterval === 0 && this.data !== null) return;
        this.pollTimeout = setTimeout(async () => {
            if (this.debug) this.debug.info('KNXTransport.doPoll.func.1');
            let errorOccured = false;

            this.polling = true;
            try {
                if (this.debug) this.debug.info('KNXTransport.doPoll.func.2');
                const data = await this.get();

                this.polling = false;
                this.emit('afterPoll', data);
            } catch (e) {
                if (this.debug) this.debug.info('KNXTransport.doPoll.func.3');
                errorOccured = true;
                this.emit('error', e);
            }
            if (this.debug) this.debug.info('KNXTransport.doPoll.func.4');
            this.doPoll((errorOccured)?this.pollErrorTimeout:null);
        }, (forceTimeout!==undefined && forceTimeout!==null) ? forceTimeout : (this.data === null) ? 0 : this.pollInterval);
    }
    stopPolling() {
        if (this.debug) this.debug.info('KNXTransport.stopPolling');
        this.pollStarted = false;
        clearTimeout(this.pollTimeout);
    }
    handleNewData(data) {
        if (this.debug) this.debug.info('KNXTransport.handleNewData', { data, changed: this.isDataChanged(data), previousData: this.data, typeof_data: (typeof data) });
        if (this.isDataChanged(data)) {
            if (this.debug) this.debug.info('KNXTransport.handleNewData', { data, changed: this.isDataChanged(data), previousData: this.data });
            this.data = data;
            this.emit('dataChanged', data);
        }
    }
}

module.exports = KNXTransport;
