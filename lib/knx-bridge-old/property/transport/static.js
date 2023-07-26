const BaseTransport = require('./index');


class StaticTransport extends BaseTransport {
    constructor(config) {
        super(config);
        if (config.data !== undefined) this.data = config.data;
        this.settable = (config.settable === undefined) ? true : (!!config.settable);
    }
    async get() {
        this.emit('afterGet', this.data);

        return this.data;
    }
    // eslint-disable-next-line no-unused-vars
    async set(data) {
        this.emit('afterGet', this.data);
    }
    async start() {
        this.on('afterGet', this._handlerNewData);
        this.on('afterSet', this._handlerNewData);
    }
    async stop() {
        this.off('afterGet', this._handlerNewData);
        this.off('afterSet', this._handlerNewData);
    }
    _handlerNewData(data) {
        if (this.isDataChanged(data)) {
            this.data = data;
            this.emit('dataChanged', data);
        }
    }
}

module.exports = StaticTransport;
