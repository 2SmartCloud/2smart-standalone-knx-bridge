const EventEmitter = require('events');
const _ = require('underscore');
const Promise = require('bluebird');
const Property = require('./property');
const PropertyTransport = require('./property/transport');


class NodeBridge extends EventEmitter {
    constructor(config) {
        super();
        // DEBUG
        this.debug = config.debug || null;
        // DEBUG END

        const id = `${config.id}`;
        const slaveId = (config.slaveId !== undefined) ? config.slaveId : 1;

        this.id = id;
        this.slaveId = slaveId;
        this.deviceBridge = config.deviceBridge;
        this.bridge = config.bridge;
        this.state = null;
        this.pendingState = 'init';
        this.props = _.defaults(_.pick(config, 'name', 'type'), {
            name : 'KNX Node Bridge'
        });

        this.started = false;
        this.connected = false;
        this.initialized = false;

        this.propertyTransports = [];
        (config.transports || []).forEach((propertyTransportConfig) => {
            return this.addPropertyTransport({ ...propertyTransportConfig, bridge: config.bridge, node: this, debug: config.debug });
        });

        const createProperty = (propertyConfig) => {
            let propertyTransport;

            if (propertyConfig.transportId) propertyTransport = this.getPropertyTransportById(propertyConfig.transportId);
            else propertyTransport = this.addPropertyTransport({ ...propertyConfig.transport, bridge: config.bridge, node: this, debug: config.debug });

            return new Property({
                ...propertyConfig,
                bridge : this.bridge,
                propertyTransport,
                debug  : config.debug
            });
        };

        this.telemetry = (config.telemetry || []).map(createProperty);
        this.options = (config.options || []).map(createProperty);
        this.sensors = (config.sensors || []).map(createProperty);

        // handlers

        this.handleConnected = this.handleConnected.bind(this);
        this.handleDisconnected = this.handleDisconnected.bind(this);
        this.handleHomieAttributeSet = this.handleHomieAttributeSet.bind(this);
        this.handleHomieAttributePublish = this.handleHomieAttributePublish.bind(this);
        this.handleErrorPropagate = this.handleErrorPropagate.bind(this);
    }
    toHomieJSON() {
        return {
            ...this.props,
            id        : this.id,
            state     : this.pendingState || this.state,
            telemetry : this.telemetry.map((propertyBridge) => {
                return propertyBridge.toHomieJSON();
            }),
            options : this.options.map((propertyBridge) => {
                return propertyBridge.toHomieJSON();
            }),
            sensors : this.sensors.map((propertyBridge) => {
                return propertyBridge.toHomieJSON();
            })
        };
    }
    async start() {
        if (this.debug) this.debug.info('NodeBridge.start');
        this.started = true;
    }
    async stop() {
        if (this.debug) this.debug.info('NodeBridge.stop');
        clearTimeout(this.processStateTimeout);
        this.started = false;
    }
    async startTransports() {
        await Promise.each(this.propertyTransports, async (transport) => {
            transport.on('connected', this.handleConnected);
            transport.on('disconnected', this.handleDisconnected);
            transport.on('error', this.handleErrorPropagate);
            await transport.start();
        });
    }
    async stopTransports() {
        await Promise.each(this.propertyTransports, async (transport) => {
            await transport.stop();
            transport.off('connected', this.handleConnected);
            transport.off('disconnected', this.handleDisconnected);
            transport.off('error', this.handleErrorPropagate);
        });
    }

    addPropertyTransport(propertyTransport) {
        if (this.debug) this.debug.info('NodeBridge.addPropertyTransport');
        if (propertyTransport instanceof PropertyTransport) {
            if (!this.propertyTransports.find((transport) => transport === propertyTransport)) this.propertyTransports.push(propertyTransport);
        } else {
            if (propertyTransport.id && this.getPropertyTransportById(propertyTransport.id)) throw new Error(`Duplicate transportId = ${propertyTransport.transportId}`);

            propertyTransport = PropertyTransport.create(propertyTransport);
            this.propertyTransports.push(propertyTransport);
        }
        return propertyTransport;
    }
    getPropertyTransportById(id) {
        if (this.debug) this.debug.info('NodeBridge.getPropertyTransportById', id);
        return this.propertyTransports.find((propertyTransport) => propertyTransport.id === id);
    }
    async setHomieNode(homieNode) {
        await this.dropHomieNode();
        if (!homieNode) {
            this.homieNode = null;
            return;
        }
        if (homieNode.id !== this.id) throw new Error('Node id do not match homie node id.');
        this.homieNode = homieNode;

        const func = (homieProperties) => async (property) => {
            const homieProperty = homieProperties.find((_homieProperty) => _homieProperty.id === property.id);

            if (!homieProperty) throw new Error(`Cannot find property with id=${property.id} in homie properties list.`);
            property.on('error', this.handleErrorPropagate);
            await property.setHomieProperty(homieProperty);
        };

        await Promise.each(this.options, func(homieNode.getOptions()));
        await Promise.each(this.telemetry, func(homieNode.getTelemetry()));
        await Promise.each(this.sensors, func(homieNode.getSensors()));

        // SET EVENT HANDLERS
        this.start();
        this.initialized = true;
        this.doStateRevision();
        // SET EVENT HANDLERS END
    }
    async dropHomieNode() {
        if (this.homieNode) {
            // DROP EVENT HANDLERS
            this.stop();
            // DROP EVENT HANDLERS END

            await Promise.each(this.options, async (property) => {
                property.off('error', this.handleErrorPropagate);
                await property.dropHomieProperty();
            });
            await Promise.each(this.telemetry, async (property) => {
                property.off('error', this.handleErrorPropagate);
                await property.dropHomieProperty();
            });
            await Promise.each(this.sensors, async (property) => {
                property.off('error', this.handleErrorPropagate);
                await property.dropHomieProperty();
            });
            this.initialized = false;
            this.homieNode = null;
            this.doStateRevision();
        }
    }
    // HANDLERS
    handleConnected() {
        this.connected = true;
        this.initialized = false;
        this.doStateRevision();
    }
    handleDisconnected() {
        this.connected = false;
        this.doStateRevision();
    }
    // eslint-disable-next-line no-unused-vars
    async handleHomieAttributeSet(name, value) {}
    async handleHomieAttributePublish(name, value) {
        if (this.debug) this.debug.info('NodeBridge.handleHomieAttributePublish', { name, value });
        if (name === 'state') {
            if (value === this.pendingState) {
                this.state = this.pendingState;
                this.pendingState = null;
            }
        }
    }
    async handleErrorPropagate(error) {
        error.node = { id: this.id };
        this.emit('error', error);
    }
    // HANDLERS END

    /* async initialize(){
        if (this.connected === null) throw new Error('Waiting for node connection status.');
    } */

    async _processState() {
        if (this.debug) this.debug.info('NodeBridge._processState',  { state: this.state, pendingState: this.pendingState });
        if (!this.started) return;
        if (this.pendingState === null) return;
        clearTimeout(this.processStateTimeout);
        if (this._processStateRunning) { this._processStateAgainTimeout = 0; return; }
        this._processStateRunning = true;
        if (this.pendingState === 'init') {
            /* await this.initialize().then(()=>{
                console.log(`node(id=${this.id}) initialized`);
                this._afterInitialize();
            }, (error)=>{
                console.log(error);
                this.processStateTimeout = setTimeout(this._processState.bind(this), 10000)
            });*/
            this._afterInitialize();
        }
        if (this.pendingState === 'ready') {
            this.debug.logger(`node(id=${this.id}) ready`);
            this.homieNode.publishAttribute('state', this.pendingState);
        }
        else if (this.pendingState === 'disconnected') {
            this.debug.logger(`node(id=${this.id}) disconnected`);
            this.homieNode.publishAttribute('state', this.pendingState);
        }
        else throw new Error('Wrong state.');
        this._processStateRunning = false;
        if (this.debug) this.debug.info('NodeBridge._processState.setTimeout', { _processStateAgainTimeout: this._processStateAgainTimeout });

        clearTimeout(this.processStateTimeout);// again in this method because of atomic operations
        this._processStateAgainTimeout = Math.min(((this._processStateAgainTimeout === null || this._processStateAgainTimeout === undefined) ? Infinity : this._processStateAgainTimeout), 10000);
        if (this._processStateAgainTimeout !== null && this._processStateAgainTimeout !== undefined) {
            if (this.debug) this.debug.info('NodeBridge._processState.setTimeout.2', { _processStateAgainTimeout: this._processStateAgainTimeout });
            this.processStateTimeout = setTimeout(this._processState.bind(this), this._processStateAgainTimeout);
            this._processStateAgainTimeout = null;
        }
    }

    _afterInitialize() {
        this.initialized = true;
        this.doStateRevision();
    }

    // state revision hook. Changes state depending on class state
    doStateRevision() {
        if (this.debug) this.debug.info('NodeBridge.doStateRevision', { started: this.started, connected: this.connected, initialized: this.initialized });
        if (!this.homieNode) return;
        this.setState((this.initialized)? (this.connected) ? 'ready' : 'disconnected' : 'init');
    }
    setState(newState) {
        if (this.debug) this.debug.info('NodeBridge.newState', { newState, pendingState: this.pendingState, state: this.state });
        if ((this.pendingState || this.state) !== newState) {
            this.pendingState = newState;
            this.emit('stateChanged', newState);
            process.nextTick(this._processState.bind(this));
        }
    }
}

NodeBridge.create = function (config) {
    let fullNodeBridgeConfig = {};

    const params = [];

    if (config.hardware) {
        const arr = config.hardware.split('.');

        fullNodeBridgeConfig = null;
        while (arr.length) {
            try {
                if (config.debug) config.debug.logger(`../../etc/config.nodes/${arr.join('.')}`);
                fullNodeBridgeConfig = require(`../../etc/config.nodes/${arr.join('.')}`);
            } catch (e) {
                if (e.code!=='MODULE_NOT_FOUND') throw e;
                if (config.debug) config.debug.error(e);
                params.unshift(arr.pop());
            }
            if (fullNodeBridgeConfig) break;
        }
        if (fullNodeBridgeConfig === null) throw new Error(`Cannot load node module(${config.hardware})`);
    }
    if (typeof fullNodeBridgeConfig === 'function') fullNodeBridgeConfig = fullNodeBridgeConfig(...params);

    return new NodeBridge({
        ...fullNodeBridgeConfig,
        ...config
    });
};

module.exports = NodeBridge;
