const BaseDeviceBridge = require('homie-sdk/lib/Bridge/BaseDevice');
const BaseNodeBridge = require('homie-sdk/lib/Bridge/BaseNode');
const BasePropertyBridge = require('homie-sdk/lib/Bridge/BaseProperty');
const BasePropertyTransport = require('homie-sdk/lib/Bridge/BasePropertyTransport');
const NodeBridge = require('./node');
const { create : createTransport } = require('./transport');

const { create : createNode } = NodeBridge;
const PropertyBridge = require('./property');

class DeviceBridge extends BaseDeviceBridge {
    constructor(config, { debug } = {}) {
        super({ ...config, transports: null, options: null, telemetry: null, nodes: null }, { debug });
        // bindind handlers~
        this.handleKNXConnected = this.handleKNXConnected.bind(this);
        this.handleKNXDisconnected = this.handleKNXDisconnected.bind(this);
        // ~bindind handlers

        if (config.knxConnectionIp) {
            this.addTelemetry(new PropertyBridge({
                'id'       : 'ip',
                'unit'     : '',
                'retained' : 'true',
                'settable' : 'false',
                'name'     : 'Ip address',
                'value'    : config.knxConnectionIp
            }, {
                type  : 'telemetry',
                debug : this.debug
            }));
        }

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
        if (config.nodes) {
            for (let node of config.nodes) {
                if (!(node instanceof BaseNodeBridge)) {
                    node = createNode({ ...node }, { debug });
                }
                this.addNode(node);
            }
        }
    }
    // sync
    attachBridge(bridge) {
        super.attachBridge(bridge);
        this.bridge.on('knx.connected', this.handleKNXConnected);
        this.bridge.on('knx.disconnected', this.handleKNXDisconnected);
    }
    detachBridge() {
        this.bridge.off('knx.connected', this.handleKNXConnected);
        this.bridge.off('knx.disconnected', this.handleKNXDisconnected);
        super.detachBridge();
    }
    // async
    // handlers~
    async handleKNXConnected() {
        if (this.debug) this.debug.info('DeviceBridge.handleKNXConnected');
        this.connected = true;
    }
    async handleKNXDisconnected() {
        if (this.debug) this.debug.info('DeviceBridge.handleKNXDisconnected');
        this.connected = false;
    }
    // ~handlers
}

module.exports = DeviceBridge;
