const EventEmitter = require('events');
const _ = require('underscore');
const Promise = require('bluebird');
const NodeBridge = require('./node');
const Deferred = require('./../Deferred/Deferred');
const Property = require('./property');
const PropertyTransport = require('./property/transport');


class DeviceBridge extends EventEmitter {
    constructor(config) {
        super();
        // DEBUG
        this.debug = config.debug || null;
        // DEBUG END

        const id = `${config.id || config.bridge.mqttConnectionConfig.username}`;

        this.id = id;
        this.state = null;
        this.pendingState = 'init';
        this.bridge = config.bridge;
        this.props = _.defaults(_.pick(config, 'name', 'implementation', 'mac', 'firmwareVersion', 'firmwareName'), {
            name            : 'KNX Device Bridge',
            implementation  : 'KnxBridge',
            mac             : '-',
            firmwareVersion : 'firmwareVersion',
            firmwareName    : 'firmwareName',
            localIp         : config.bridge.knxConnection.remoteEndpoint.addrstring
        });

        this.started = false;
        this.connected = false;
        this.connectionReady = false;
        this.initialized = false;

        const config_telemetry = [ {
            transport : {
                type : 'static',
                // eslint-disable-next-line more/no-duplicated-chains
                data : config.bridge.knxConnection.remoteEndpoint.addrstring
            },
            'dataTypeBridge' : {
                type          : 'raw',
                homieDataType : 'string'
            },
            'id'       : 'ip',
            'unit'     : '',
            'retained' : 'true',
            'settable' : 'false',
            'name'     : 'Ip address'
        } ];

        const config_options = [];

        this.propertyTransports = [];

        (config.propertyTransports || []).forEach((propertyTransportConfig) => {
            return this.addPropertyTransport(propertyTransportConfig);
        });

        const createProperty = (propertyConfig) => {
            let propertyTransport;

            if (propertyConfig.transportId) {
                propertyTransport = this.getPropertyTransportById(propertyConfig.transportId);
                if (!propertyTransport) throw new Error(`Cannot find tranport with id ${propertyConfig.transportId}`);
            }
            else propertyTransport = this.addPropertyTransport(propertyConfig.transport);

            return new Property({
                ...propertyConfig,
                nodeBridge : this,
                bridge     : this.bridge,
                propertyTransport,
                debug      : config.debug
            });
        };

        this.telemetry = config_telemetry.map(createProperty);
        this.options = config_options.map(createProperty);


        this.nodes = config.nodes.map((nodeBridgeConfig) => {
            return NodeBridge.create({ ...nodeBridgeConfig, bridge: this.bridge, deviceBridge: this, debug: config.debug });
        });

        // handlers

        this._handleHomieConnect = this._handleHomieConnect.bind(this);

        this._handleKNXConnectionReady = this._handleKNXConnectionReady.bind(this);
        this._handleKNXConnected = this._handleKNXConnected.bind(this);
        this._handleKNXDisconnected = this._handleKNXDisconnected.bind(this);

        this.handleHomieAttributeSet = this.handleHomieAttributeSet.bind(this);
        this.handleHomieAttributePublish = this.handleHomieAttributePublish.bind(this);
        this._strangehandleHomieDeviceAttributePublish = this._strangehandleHomieDeviceAttributePublish.bind(this);
        this._strangehandleHomieDeviceAttributeSet = this._strangehandleHomieDeviceAttributeSet.bind(this);
        this._handleHomieDeviceHeartbeat = this._handleHomieDeviceHeartbeat.bind(this);
        this.handleErrorPropagate = this.handleErrorPropagate.bind(this);

        // late initialization
        this.homieDevice = null;
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
            nodes : this.nodes.map((nodeBridge) => {
                return nodeBridge.toHomieJSON();
            })
        };
    }
    async start() {
        if (this.debug) this.debug.info('DeviceBridge.start');
        this.bridge.on('homie.connect', this._handleHomieConnect);
        this.bridge.on('knx.connection.ready', this._handleKNXConnectionReady);
        this.bridge.on('knx.connected', this._handleKNXConnected);
        this.bridge.on('knx.disconnected', this._handleKNXDisconnected);
        this.started = true;

        if (this.debug) this.debug.info('DeviceBridge.start.before_initWorld');
        await this.bridge.initWorld(this.id);
        if (this.debug) this.debug.info('DeviceBridge.start.after_initWorld');
    }
    async stop() {
        if (this.debug) this.debug.info('DeviceBridge.stop');
        this.bridge.off('homie.connect', this._handleHomieConnect);
        this.bridge.off('knx.connection.ready', this._handleKNXConnectionReady);
        this.bridge.off('knx.connected', this._handleKNXConnected);
        this.bridge.off('knx.disconnected', this._handleKNXDisconnected);
        clearTimeout(this.processStateTimeout);
        this.started = false;
    }
    async startTransports() {
        await Promise.each(this.propertyTransports, async (transport) => {
            transport.on('error', this.handleErrorPropagate);
            await transport.start();
        });
        await Promise.each(this.nodes, async (node) => {
            await node.startTransports();
        });
    }
    async stopTransports() {
        await Promise.each(this.propertyTransports, async (transport) => {
            transport.off('error', this.handleErrorPropagate);
            await transport.stop();
        });
        await Promise.each(this.nodes, async (node) => {
            await node.stopTransports();
        });
    }

    // HANDLERS
    async _handleHomieConnect() {
        if (this.debug) this.debug.info('DeviceBridge._handleHomieConnect');
        await this.dropHomieDevice();
        this.initialized = false;
        this.doStateRevision();
    }

    async _handleKNXConnectionReady() {
        if (this.connectionReady) return;
        if (this.debug) this.debug.info('DeviceBridge._handleKNXConnectionReady', { state: this.state, pendingState: this.pendingState });
        this.connectionReady = true;
        await this.startTransports();
    }
    async _handleKNXConnected() {
        if (this.debug) this.debug.info('DeviceBridge._handleKNXConnected', { state: this.state, pendingState: this.pendingState });
        this.connected = true;
        await this.dropHomieDevice();
        this.initialized = false;
        this.doStateRevision();
    }
    async _handleKNXDisconnected() {
        if (this.debug) this.debug.info('DeviceBridge._handleKNXDisconnected', { state: this.state, pendingState: this.pendingState });
        this.connected = false;
        this.doStateRevision();
        this.connectionReady = false;
        await this.stopTransports();
    }
    // eslint-disable-next-line no-unused-vars
    async handleHomieAttributeSet(name, value) {}
    async handleHomieAttributePublish(name, value) {
        if (this.debug) this.debug.info('DeviceBridge.handleHomieAttributePublish', { name, value });
        if (name === 'state') {
            if (value === this.pendingState) {
                this.state = this.pendingState;
                this.pendingState = null;
            }
            else if (value === 'lost') {
                this.doStateRevision();
            }
        }
    }
    // STRANGE
    async _strangehandleHomieDeviceAttributePublish(strangeobject) {
        try {
            const homieDevice = strangeobject.device;

            if (!homieDevice) throw new Error('No homie device instance.');
            if (homieDevice.id !== this.id) throw new Error('Homie device id and dridge device id do not match.');

            const homieNode = strangeobject.node;

            let node = null;

            if (homieNode) {
                node = this.nodes.find((_node) => _node.id === homieNode.id);
                if (!node) return;// throw new Error(`cannot find node bridge with id=${homieNode.id}`);
            }

            const homieProperty = strangeobject.property;

            if (strangeobject.type === 'DEVICE') {
                // this.emit('homie.publish', strangeobject.field, strangeobject.value);
                await this.handleHomieAttributePublish(strangeobject.field, strangeobject.value);
                this.emit('homie.change', {
                    device : {
                        id                    : this.id,
                        [strangeobject.field] : strangeobject.value
                    }
                });
            } else if (strangeobject.type === 'DEVICE_OPTION') {
                if (!homieProperty) throw new Error('No homie property instance.');
                const property = this.options.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);

                // property.emit('homie.publish', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributePublish(strangeobject.field, strangeobject.value);

                this.emit('homie.change', {
                    device : {
                        options : [ {
                            id                    : property.id,
                            [strangeobject.field] : strangeobject.value
                        } ]
                    }
                });
            } else if (strangeobject.type === 'DEVICE_TELEMETRY') {
                if (!homieProperty) throw new Error('No homie property instance.');
                const property = this.telemetry.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);

                // property.emit('homie.publish', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributePublish(strangeobject.field, strangeobject.value);

                this.emit('homie.change', {
                    device : {
                        telemetry : [ {
                            id                    : property.id,
                            [strangeobject.field] : strangeobject.value
                        } ]
                    }
                });
            } else if (strangeobject.type === 'NODE') {
                if (!homieNode) throw new Error('No homie node instance.');
                // node.emit('homie.publish', strangeobject.field, strangeobject.value);
                await node.handleHomieAttributePublish(strangeobject.field, strangeobject.value);

                this.emit('homie.change', {
                    device : {
                        nodes : [ {
                            id                    : node.id,
                            [strangeobject.field] : strangeobject.value
                        } ]
                    }
                });
            } else if (strangeobject.type === 'NODE_OPTION') {
                if (!homieNode) throw new Error('No homie node instance.');
                const property = node.options.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);
                // property.emit('homie.publish', strangeobject.field, strangeobject.value);
                await node.handleHomieAttributePublish(strangeobject.field, strangeobject.value);

                this.emit('homie.change', {
                    device : {
                        nodes : [ {
                            id      : node.id,
                            options : [ {
                                id                    : property.id,
                                [strangeobject.field] : strangeobject.value
                            } ]
                        } ]
                    }
                });
            } else if (strangeobject.type === 'NODE_TELEMETRY') {
                if (!homieNode) throw new Error('No homie node instance.');
                const property = node.telemetry.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${homieProperty.id}`);
                // property.emit('homie.publish', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributePublish(strangeobject.field, strangeobject.value);

                this.emit('homie.change', {
                    device : {
                        nodes : [ {
                            id        : node.id,
                            telemetry : [ {
                                id                    : property.id,
                                [strangeobject.field] : strangeobject.value
                            } ]
                        } ]
                    }
                });
            } else if (strangeobject.type === 'SENSOR') {
                if (!homieNode) throw new Error('No homie node instance.');

                const property = node.sensors.find((_property) => _property.id === homieProperty.id);

                if (!property) return; // throw new Error(`cannot find property bridge with id=${homieProperty.id}`);
                // property.emit('homie.publish', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributePublish(strangeobject.field, strangeobject.value);

                this.emit('homie.change', {
                    device : {
                        sensors : [ {
                            id        : node.id,
                            telemetry : [ {
                                id                    : property.id,
                                [strangeobject.field] : strangeobject.value
                            } ]
                        } ]
                    }
                });
            } else throw new Error(`Unknown strangeobject.type(${strangeobject.type})`);
        } catch (e) {
            this.debug.warning('DeviceBridge._strangehandleHomieDeviceAttributePublish', e);
        }
    }
    async _strangehandleHomieDeviceAttributeSet(strangeobject) {
        try {
            const homieDevice = strangeobject.device;

            if (!homieDevice) throw new Error('No homie device instance.');
            if (homieDevice.id !== this.id) throw new Error('Homie device id and dridge device id do not match.');

            const homieNode = strangeobject.node;
            // if(!homieNode) throw new Error('No homie node instance.');

            let node = null;

            if (homieNode) {
                node = this.nodes.find((_node) => _node.id === homieNode.id);
                if (!node) throw new Error(`cannot find node bridge with id=${homieNode.id}`);
            }

            const homieProperty = strangeobject.property;

            if (strangeobject.type === 'DEVICE') {
                // this.emit('homie.set', strangeobject.field, strangeobject.value);
                await this.handleHomieAttributeSet(strangeobject.field, strangeobject.value);
            } else if (strangeobject.type === 'DEVICE_OPTION') {
                if (!homieProperty) throw new Error('No homie property instance.');
                const property = this.options.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);

                // property.emit('homie.set', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributeSet(strangeobject.field, strangeobject.value);
            } else if (strangeobject.type === 'DEVICE_TELEMETRY') {
                if (!homieProperty) throw new Error('No homie property instance.');
                const property = this.telemetry.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);

                // property.emit('homie.set', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributeSet(strangeobject.field, strangeobject.value);
            } else if (strangeobject.type === 'NODE') {
                if (!homieNode) throw new Error('No homie node instance.');

                // node.emit('homie.set', strangeobject.field, strangeobject.value);
                await node.handleHomieAttributeSet(strangeobject.field, strangeobject.value);
            } else if (strangeobject.type === 'NODE_OPTION') {
                if (!homieNode) throw new Error('No homie node instance.');
                const property = node.options.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);

                // property.emit('homie.set', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributeSet(strangeobject.field, strangeobject.value);
            } else if (strangeobject.type === 'NODE_TELEMETRY') {
                if (!homieNode) throw new Error('No homie node instance.');
                const property = node.telemetry.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);

                // property.emit('homie.set', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributeSet(strangeobject.field, strangeobject.value);
            } else if (strangeobject.type === 'SENSOR') {
                if (!homieNode) throw new Error('No homie node instance.');
                const property = node.sensors.find((_property) => _property.id === homieProperty.id);

                if (!property) throw new Error(`cannot find property bridge with id=${property.id}`);

                // property.emit('homie.set', strangeobject.field, strangeobject.value);
                await property.handleHomieAttributeSet(strangeobject.field, strangeobject.value);
            } else throw new Error(`Unknown strangeobject.type(${strangeobject.type})`);
        } catch (e) {
            this.debug.warning('DeviceBridge._strangehandleHomieDeviceAttributeSet', e);
        }
    }
    // STRANGE END
    async _handleHomieDeviceHeartbeat(token) {
        if (this.connected) this.homieDevice.respondToHeartbeat(token);
    }
    async handleErrorPropagate(error) {
        error.device = { id: this.id };
        this.emit('error', error);
    }
    // HANDLERS END

    async initialize() {
        if (this.debug) this.debug.info('DeviceBridge.initialize');
        const deferred = new Deferred();

        let timeout;
        // eslint-disable-next-line no-unused-vars
        const handler = (topic, value) => {
            const id = topic.split('/')[1];

            if (this.id === id) {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    if (this.debug) this.debug.info('DeviceBridge.initialize.handler');
                    client.off('message', handler);
                    deferred.resolve();
                }, 100);
            }
        };

        const client = this.bridge.homie.transport.client;

        client.on('message', handler);
        deferred.registerTimeout(10000, () => {
            if (this.debug) this.debug.info('DeviceBridge.initialize.timeout');
            client.off('message', handler);
        });
        if (this.debug) this.debug.info('DeviceBridge.initialize.publishDevice', JSON.stringify(this.toHomieJSON(), null, 4));
        await this.bridge.publishDevice(this.toHomieJSON());
        await deferred._promise;

        if (this.debug) this.debug.info('DeviceBridge.initialize.after');
        await this.setHomieDevice(this.bridge.getDeviceById(this.id));
    }
    addPropertyTransport(propertyTransport) {
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
        return this.propertyTransports.find((propertyTransport) => propertyTransport.id === id);
    }
    async setHomieDevice(homieDevice) {
        await this.dropHomieDevice();
        if (!homieDevice) {
            this.homieDevice = null;

            return;
        }
        if (homieDevice.id !== this.id) throw new Error('Device id do not match homie device id.');
        this.homieDevice = homieDevice;

        const func = (homieProperties) => async (property) => {
            const homieProperty = homieProperties.find((_homieProperty) => _homieProperty.id === property.id);

            if (!homieProperty) throw new Error(`Cannot find property with id=${property.id} in homie properties list.`);
            property.on('error', this.handleErrorPropagate);
            await property.setHomieProperty(homieProperty);
        };

        await Promise.each(this.options, func(homieDevice.getOptions()));
        await Promise.each(this.telemetry, func(homieDevice.getTelemetry()));

        const homieNodes = homieDevice.getNodes();

        await Promise.each(this.nodes, async (node) => {
            const homieNode = homieNodes.find((_homieNode) => _homieNode.id === node.id);

            if (!homieNode) throw new Error(`Cannot find node with id=${node.id} in homie device nodes.`);
            node.on('error', this.handleErrorPropagate);
            await node.setHomieNode(homieNode);
        });

        // SET EVENT HANDLERS
        homieDevice.onAttributePublish(this._strangehandleHomieDeviceAttributePublish);
        homieDevice.onAttributeSet(this._strangehandleHomieDeviceAttributeSet);
        homieDevice.onHeartbeat(this._handleHomieDeviceHeartbeat);
        // SET EVENT HANDLERS END
    }
    async dropHomieDevice() {
        if (this.homieDevice) {
            // DROP EVENT HANDLERS
            // throw new Error('Cannot drop handlers.');
            // DROP EVENT HANDLERS END
            await Promise.each(this.options, async (property) => {
                property.off('error', this.handleErrorPropagate);
                await property.dropHomieProperty();
            });
            await Promise.each(this.telemetry, async (property) => {
                property.off('error', this.handleErrorPropagate);
                await property.dropHomieProperty();
            });
            await Promise.each(this.nodes, async (node) => {
                node.off('error', this.handleErrorPropagate);
                await node.dropHomieNode();
            });
            this.homieDevice = null;
        }
    }

    async _processState() {
        if (this.debug) this.debug.info('DeviceBridge._processState', { state: this.state, pendingState: this.pendingState });
        if (!this.started || !this.bridge.homieConnected) return;
        if (this.pendingState === null) return;
        clearTimeout(this.processStateTimeout);
        if (this._processStateRunning) { this._processStateAgainTimeout = 0; return; }
        this._processStateRunning = true;
        if (this.pendingState === 'init') {
            await this.initialize().then(() => {
                this.debug.logger(`device(id=${this.id}) initialized`);
                this._afterInitialize();
            }, (error) => {
                this.debug.warning(`DeviceBridge._processState device(id=${this.id})`, error);
            });
            this.debug.logger(`after device(id=${this.id}) initialized`);
        }
        else if (this.pendingState === 'ready') {
            this.debug.logger(`device(id=${this.id}) ready`);
            this.homieDevice.publishAttribute('state', this.pendingState);
        }
        else if (this.pendingState === 'disconnected') {
            this.debug.logger(`device(id=${this.id}) disconnected`);
            this.homieDevice.publishAttribute('state', this.pendingState);
        }
        else throw new Error('Wrong state.');
        this._processStateRunning = false;
        if (this.debug) this.debug.info('DeviceBridge._processState.setTimeout');

        clearTimeout(this.processStateTimeout);// again in this method because of atomic operations
        this._processStateAgainTimeout = Math.min(((this._processStateAgainTimeout === null || this._processStateAgainTimeout === undefined) ? Infinity : this._processStateAgainTimeout), 10000);
        if (this._processStateAgainTimeout !== null && this._processStateAgainTimeout !== undefined) {
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
        if (this.debug) this.debug.info('DeviceBridge.doStateRevision', { started: this.started, connected: this.connected, initialized: this.initialized });
        this.setState((this.initialized)? (this.connected) ? 'ready' : 'disconnected' : 'init');
    }
    setState(newState) {
        if (this.debug) this.debug.info('DeviceBridge.newState', newState);
        if ((this.pendingState || this.state) !== newState) {
            this.pendingState = newState;
            this.emit('stateChanged', newState);
        }
        process.nextTick(this._processState.bind(this));
    }
}
DeviceBridge.create = function (config) {
    return new DeviceBridge(config);
};

module.exports = DeviceBridge;
