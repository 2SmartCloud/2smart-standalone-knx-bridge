const BaseNodeBridge = require('homie-sdk/lib/Bridge/BaseNode');
const BasePropertyBridge = require('homie-sdk/lib/Bridge/BaseProperty');
const BasePropertyTransport = require('homie-sdk/lib/Bridge/BasePropertyTransport');
const { create : createTransport } = require('./transport');
const PropertyBridge = require('./property');

class NodeBridge extends BaseNodeBridge {
    constructor(config, { debug } = {}) {
        super({ ...config, transports: null, options: null, telemetry: null, sensors: null }, { debug });
        // bindind handlers~
        this.handleConnected = this.handleConnected.bind(this);
        this.handleDisconnected = this.handleDisconnected.bind(this);
        // ~bindind handlers

        if (config.transports) {
            for (let transport of config.transports) {
                if (!(transport instanceof BasePropertyTransport)) transport = createTransport({ ...transport, debug });
                this.addPropertyTransport(transport);
            }
        }
        if (config.options) {
            for (let option of config.options) {
                if (!(option instanceof BasePropertyBridge)) {
                    option = new PropertyBridge(option, {
                        type      : 'option',
                        transport : (option.transportId) ?
                            this.getPropertyTransportById(option.transportId) :
                            this.addPropertyTransport(createTransport({ ...option.transport, debug })),
                        debug
                    });
                }
                this.addOption(option);
            }
        }
        if (config.telemetry) {
            for (let telemetry of config.telemetry) {
                if (!(telemetry instanceof BasePropertyBridge)) {
                    telemetry = new PropertyBridge(telemetry, {
                        type      : 'telemetry',
                        transport : (telemetry.transportId) ?
                            this.getPropertyTransportById(telemetry.transportId) :
                            this.addPropertyTransport(createTransport({ ...telemetry.transport, debug })),
                        debug
                    });
                }
                this.addTelemetry(telemetry);
            }
        }
        if (config.sensors) {
            for (let sensor of config.sensors) {
                if (!(sensor instanceof BasePropertyBridge)) {
                    sensor = new PropertyBridge(sensor, {
                        type      : 'sensor',
                        transport : (sensor.transportId) ?
                            this.getPropertyTransportById(sensor.transportId) :
                            this.addPropertyTransport(createTransport({ ...sensor.transport, debug })),
                        debug
                    });
                }
                this.addSensor(sensor);
            }
        }
        if (config.ping) {
            console.log('config.ping');
            // eslint-disable-next-line no-unused-vars
            const pingTransport = (config.ping.transportId) ?
                this.getPropertyTransportById(config.ping.transportId) :
                this.addPropertyTransport(createTransport({ ...config.ping.transport, debug }));
        }
    }
    // sync
    attachBridge(bridge) {
        for (const transport of this.propertyTransports) transport.attachBridge(bridge);
        super.attachBridge(bridge);
    }
    detachBridge() {
        for (const transport of this.propertyTransports) transport.detachBridge();
        super.detachBridge();
    }
    addPropertyTransport(propertyTransport) {
        if (this.propertyTransports.includes(propertyTransport)) return propertyTransport;
        super.addPropertyTransport(propertyTransport);
        propertyTransport.on('connected', this.handleConnected);
        propertyTransport.on('disconnected', this.handleDisconnected);
        return propertyTransport;
    }
    removePropertyTransport(id) {
        const propertyTransport = super.removePropertyTransport(id);

        propertyTransport.off('connected', this.handleConnected);
        propertyTransport.off('disconnected', this.handleDisconnected);

        return propertyTransport;
    }
    // async
    // handlers~
    handleConnected() {
        if (this.debug) this.debug.info('NodeBridge.handleConnected');
        this.connected = true;
    }
    handleDisconnected() {
        if (this.debug) this.debug.info('NodeBridge.handleDisconnected');
        this.connected = false;
    }
    // ~handlers
}

NodeBridge.create = function (config, options) {
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
    }, options);
};

module.exports = NodeBridge;
