// eslint-disable-next-line import/no-extraneous-dependencies
const EventEmitter = require('events');
const _ = require('underscore');
// const Promise = require('bluebird');
const BaseBridge = require('homie-sdk/lib/Bridge');
const MQTTTransport = require('homie-sdk/lib/Broker/mqtt');
const Homie = require('homie-sdk/lib/homie/Homie');
const knx = require('../knx');
const Deferred = require('../Deferred/Deferred');
const DeviceBridge = require('./device');

class KnxBridge extends BaseBridge {
    constructor(config) {
        const mqttConnectionConfig = _.defaults(_.clone(config.mqttConnection || {}), {
            username : '',
            password : '',
            uri      : 'mqtt://localhost:1883'
        });
        const transport = new MQTTTransport({
            ...mqttConnectionConfig,
            tls : { enable: true, selfSigned: true }
        });

        const homie = new Homie({ transport });

        super({ homie });
        this.mqttConnectionConfig = mqttConnectionConfig;
        this.homieConnected = false;

        this.knxConnection = knx.Connection({
            ipAddr         : config.knxConnection.ipAddr,
            ipPort         : config.knxConnection.ipPort,
            physAddr       : config.knxConnection.physAddr,
            forceTunneling : config.knxConnection.forceTunneling,
            localIp        : config.knxConnection.localIp,
            receivePort    : config.knxConnection.receivePort,
            listenPort     : config.knxConnection.listenPort,
            manualConnect  : true,
            handlers       : {
                connected() {
                    if (this.debug) this.debug.info('KnxBridge.knxConnection.events.connected');
                },
                disconnected() {
                    if (this.debug) this.debug.info('KnxBridge.knxConnection.events.disconnected');
                },
                event(evt, src, dest, value) {
                    if (this.debug) this.debug.info('KnxBridge.knxConnection.events', { evt, src, dest, value });
                }
            }
        });
        this.deviceBridge = new DeviceBridge({
            ...config.device,
            bridge : this,
            debug  : config.debug
        });
        this._events = new EventEmitter();

        this._handleHomieConnect = this._handleHomieConnect.bind(this);

        this._handleKNXConnectionReady = this._handleKNXConnectionReady.bind(this);
        this._handleKNXConnected = this._handleKNXConnected.bind(this);
        this._handleKNXDisconnected = this._handleKNXDisconnected.bind(this);
        this.handleErrorPropagate = this.handleErrorPropagate.bind(this);


        // DEBUG
        this.debug = config.debug || null;
        // DEBUG END
    }
    async init() {
        if (this.debug) this.debug.info('KnxBridge.init');
        this.knxConnection.on('connected', this._handleKNXConnectionReady);
        this.knxConnection.on('connected', this._handleKNXConnected);
        this.knxConnection.on('disconnected', this._handleKNXDisconnected);
        this.knxConnection.on('error', this.handleErrorPropagate);
        this.knxConnection.Connect();

        this.homie.transport._ee.on('emqx_connect', this._handleHomieConnect);
        this.deviceBridge.on('error', this.handleErrorPropagate);
        await this.deviceBridge.start();
    }
    _handleHomieConnect() {
        if (this.debug) this.debug.info('KnxBridge.homie._handleHomieConnect');
        this.homieConnected = true;
        this.emit('homie.connect');
    }
    _handleKNXConnectionReady() {
        if (this.debug) this.debug.info('KnxBridge.knx._handleKNXConnectionReady');
        this.emit('knx.connection.ready');
    }
    _handleKNXConnected() {
        if (this.debug) this.debug.info('KnxBridge.knx._handleKNXConnected');
        this.emit('knx.connected');
    }
    _handleKNXDisconnected() {
        if (this.debug) this.debug.info('KnxBridge.knx._handleKNXDisconnected');
        this.emit('knx.disconnected');
    }

    async destroy() {
        await this.deviceBridge.stop();
        this.knxConnection.off('connected', this._handleKNXConnectionReady);
        this.knxConnection.off('connected', this._handleKNXConnected);
        this.knxConnection.off('disconnected', this._handleKNXDisconnected);

        const deferred = new Deferred();
        const onDisconnect = () => {
            deferred.resolve();
        };

        deferred.registerTimeout(2000, () => {
            deferred.reject(new Error('Disconnect timeout.'));
        });
        this.knxConnection.on('disconnected', onDisconnect);
        this.knxConnection.Disconnect();

        try {
            await deferred.promise;
        } catch (e) {
            this.handleErrorPropagate(e);
        }
        this.knxConnection.off('error', this.handleErrorPropagate);
        this.knxConnection.off('disconnected', onDisconnect);

        this.deviceBridge.off('error', this.handleErrorPropagate);
        this.homie.transport._ee.off('emqx_connect', this._handleHomieConnect);
        this.homie.end();
    }

    on() { return this._events.on(...arguments); }
    off() { return this._events.off(...arguments); }
    emit() { return this._events.emit(...arguments); }

    async handleErrorPropagate(error) {
        this.emit('error', error);
    }
}

KnxBridge.create = async function (config) {
    return new KnxBridge(config);
};

module.exports = KnxBridge;
