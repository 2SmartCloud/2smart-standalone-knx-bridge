const BaseTransport = require('homie-sdk/lib/Bridge/BasePropertyTransport');


class StaticTransport extends BaseTransport {
    constructor(config) {
        super(config);
        if (config.data !== undefined) this.data = config.data;
        this.settable = (config.settable === undefined) ? true : (!!config.settable);
    }
    async get() {
        this.handleNewData(this.data);

        return this.data;
    }
    // eslint-disable-next-line no-unused-vars
    async set(data) {
        this.handleNewData(data);
    }
}

module.exports = StaticTransport;
