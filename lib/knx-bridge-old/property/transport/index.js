const EventEmitter = require('events');
// eslint-disable-next-line import/no-extraneous-dependencies
const _ = require('underscore');

/*
* events:
* 'dataChanged', data       - is called if data is changed in any way
* 'error', error            - any error
* 'afterPoll', data         - advanced
* 'afterGet', data          - advanced
* 'afterSet', data          - advanced
* */

class BaseTransport extends EventEmitter {
    constructor(config) {
        super();
        // DEBUG
        this.debug = config.debug || null;
        // DEBUG END

        this.id = config.id || null;
        this.type = config.type;
        this.data = null;

        this.handleErrorPropagate = this.handleErrorPropagate.bind(this);
    }
    async get() {
        throw new Error('Abstract method BaseTransport.get.');
    }
    async set() {
        throw new Error('Abstract method BaseTransport.set.');
    }
    async start() {
        throw new Error('Abstract method BaseTransport.start.');
    }
    async stop() {
        throw new Error('Abstract method BaseTransport.stop.');
    }
    isDataChanged(newData) {
        return !_.isEqual(this.data, newData);
    }
    async handleErrorPropagate(error) {
        error.transport = { type: this.type };
        this.emit('error', error);
    }
}
BaseTransport.create = function (config) {
    if (config.type === 'index') throw new Error('Bad transport type.');
    const TransportClass = require(`./${config.type}`);

    return new TransportClass(config);
};

module.exports = BaseTransport;
