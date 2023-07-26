require('events').defaultMaxListeners = 100;
const Debugger = require('homie-sdk/lib/utils/debugger');
const KnxBridge = require('./lib/knx-bridge/bridge');
// const KnxLog = require('./lib/knx/src/KnxLog');

const debug = new Debugger(process.env.DEBUG || '');

debug.initEvents();
// KnxLog.get().initEvents();
try {
    // NODES
    let nodes = null;

    const config = require('./etc/nodes.config.json');

    nodes = config.deviceConfig.nodes;

    const mapping = (config.extensions && config.extensions.mapping) || {};
    const mappingPing = (config.extensions && config.extensions.mappingPing) || {};

    // eslint-disable-next-line guard-for-in
    for (const key in mapping) {
        const keys = key.split('/');

        const node = nodes.find((n) => {
            return n.id === keys[0];
        });

        if (!node) throw new Error(`Cannot find node with id ${keys[0]}`);
        let property = null;

        if (keys[1] === '$options') {
            property = node.options.find((p) => p.id === keys[2]);
            if (!property) throw new Error(`Cannot find option with id ${keys[2]} in node ${keys[0]}`);
        } else if (keys[1] === '$telemetry') {
            property = node.telemetry.find((p) => p.id === keys[2]);
            if (!property) throw new Error(`Cannot find telemetry with id ${keys[2]} in node ${keys[0]}`);
        } else {
            property = node.sensors.find((p) => p.id === keys[1]);
            if (!property) throw new Error(`Cannot find sensor with id ${keys[1]} in node ${keys[0]}`);
        }
        Object.assign(property, mapping[key]);
    }
    // eslint-disable-next-line guard-for-in
    for (const key in mappingPing) {
        const node = nodes.find((n) => {
            return n.id === key;
        });

        if (!node) throw new Error(`Cannot find node with id ${key} to map ping`);
        node.ping = mappingPing[key];
    }
    // NODES END

    if (process.env.KNX_CONNECTION_FORCE_TUNNELING && (process.env.KNX_CONNECTION_FORCE_TUNNELING !== 'true' || process.env.KNX_CONNECTION_FORCE_TUNNELING !== 'false')) {
        throw new Error('Environment variable KNX_CONNECTION_FORCE_TUNNELING must be either true or false.');
    }
    if (!process.env.KNX_CONNECTION_LOCAL_PORT_BINDING) {
        throw new Error('Please, specify environment variable KNX_CONNECTION_LOCAL_PORT_BINDING.');
    }

    const ports = process.env.KNX_CONNECTION_LOCAL_PORT_BINDING.split(':');

    if (ports.length===1) ports[1] = ports[0];

    const deviceBridgeConfig = {
        mqttConnection : {
            username : process.env.MQTT_USER || undefined,
            password : process.env.MQTT_PASS || undefined,
            uri      : process.env.MQTT_URI || undefined
        },
        knxConnection : {
            ipAddr         : process.env.KNX_CONNECTION_IP_ADDR || undefined,
            ipPort         : parseInt(process.env.KNX_CONNECTION_IP_PORT, 10) || 3671,
            physAddr       : process.env.KNX_CONNECTION_PHYS_ADDR || undefined,
            forceTunneling : JSON.parse(process.env.KNX_CONNECTION_FORCE_TUNNELING || 'true'),
            localIp        : process.env.KNX_CONNECTION_LOCAL_IP || undefined,
            receivePort    : ports[0],
            listenPort     : ports[1]
        },
        device : {
            id              : process.env.DEVICE_ID || process.env.MQTT_USER || undefined,
            name            : process.env.DEVICE_NAME || undefined,
            implementation  : process.env.DEVICE_IMPLEMENTATION || undefined,
            mac             : process.env.DEVICE_MAC || undefined,
            firmwareVersion : process.env.DEVICE_FIRMWARE_VERSION || undefined,
            firmwareName    : process.env.DEVICE_FIRMWARE_NAME || undefined,
            nodes
        }
    };

    // eslint-disable-next-line no-inner-declarations
    const knxBridge = new KnxBridge({ ...deviceBridgeConfig, debug });

    knxBridge.on('error', (error) => {
        debug.error(error);
    });
    knxBridge.on('exit', (reason, exit_code) => {
        debug.error(reason);
        process.exit(exit_code);
    });
    knxBridge.init();
} catch (e) {
    debug.error(e);
    process.exit(1);
}
