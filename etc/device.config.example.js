module.exports = {
    //mqtt
    mqttConnection:{
        username : 'username',                      // default ''
        password : 'password',                      // default ''
        uri      : 'wss://localhost:8084/mqtt'      // optional, default - 'wss://localhost:8084/mqtt'
    },

    //knx
    knxConnection:{
        ip: '127.0.0.1',                    // ip of KNXIP device
        port: 3671,                         // port of knx KNXIP interface
        physAddr:'1.1.255',                 // phys addr of KNXIP
        forceTunneling:true                 // forceTunneling, if you want to enable tunneling regardless of ip type(e.g. multicast, unicast, broadcast)
    },

    device: {
        id       : 'knx_device',                    // optional, default - mqttConnection.username
        name     : 'KNX Device Bridge',             // optional, default 'KNX Device Bridge'
        implementation  : 'KnxBridge',              // optional, default 'KnxBridge'
        mac             : 'mac-address',                    // device mac-address
        firmwareVersion : 'firmwareVersion',        // optional, default 'firmwareVersion'
        firmwareName    : 'firmwareName',           // optional, default 'firmwareName'


        telemetry: [                            // optional
            // see etc/node.config.example.js sensors, options telemetry arrays
        ],
        options: [                              // optional
            // see etc/node.config.example.js sensors, options telemetry arrays
        ],

        nodes: [
            {
                id       : 'nodeid',
                name     : 'nodename',
                sensors  : [
                    {
                        transport  : {
                            type: 'knx',                // optional, default knx
                            get: ['0/0/1'],             // required, array of group addresses
                            set: '0/0/2',               // required, set address
                            dpt: 'DPT1.001'             // data point type
                        },

                        // homie
                        'id'       : 'temperature',
                        'unit'     : '°C',
                        'retained' : true,
                        'settable' : false,
                        'name'     : 'Temperature'
                    },
                ],
                options   : [],
                telemetry : []
            }
        ]
    }
};
