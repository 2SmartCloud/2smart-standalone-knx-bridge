const EventEmitter = require('events');
// eslint-disable-next-line import/no-extraneous-dependencies
const _ = require('underscore');
const Parser = require('./parser');

class BaseProperty extends EventEmitter {
    /* {
     ...propertyConfig,
     bridge,
     propertyTransport
    } */
    constructor(config) {
        super();
        // DEBUG
        this.debug = config.debug || null;
        // DEBUG END

        const { id, propertyTransport } = config;

        this.id = `${id}`;

        this.bridge = config.bridge;
        this.propertyTransport = propertyTransport;

        this.parser = Parser.create(config.dataTypeBridge || { type: 'raw', homieDataType: config.dataType });

        this.retained = (config.retained === undefined) ? true : (config.retained === true || config.retained === 'true');
        this.settable = (config.settable === undefined) ? propertyTransport.settable : (config.settable === true || config.settable === 'true');
        this.restoreHomieValue = (config.restoreHomieValue === true) || false;
        if (this.settable && !propertyTransport.settable) throw new Error('propertyTransport is not settable.');

        this.pendingHomieValue = null;

        this.props = _.defaults(_.pick(config, 'unit', 'name'), {
            name : 'Sensor Name'
        });

        // handlers

        this.handlePropertyTransportDataChanged = this.handlePropertyTransportDataChanged.bind(this);

        this.handleHomieAttributeSet = this.handleHomieAttributeSet.bind(this);
        this.handleHomieAttributePublish = this.handleHomieAttributePublish.bind(this);
        this.handleErrorPropagate = this.handleErrorPropagate.bind(this);
    }
    toHomieJSON() {
        const res = {
            ...this.props,
            id       : this.id,
            dataType : this.parser.homieDataType,
            retained : this.retained ? 'true' : 'false',
            settable : this.settable ? 'true' : 'false'
        };

        if (this.value() !== undefined) res.value = this.value();

        return res;
    }
    async start() {
        if (this.debug) this.debug.info('BaseProperty.start');
        this.propertyTransport.on('dataChanged', this.handlePropertyTransportDataChanged);
        if (this.propertyTransport.data) this.handlePropertyTransportDataChanged(this.propertyTransport.data);
    }
    async stop() {
        if (this.debug) this.debug.info('BaseProperty.stop');
        this.propertyTransport.off('dataChanged', this.handlePropertyTransportDataChanged);
    }
    value() {
        return this.homieValue;
    }
    async setValue(homieValue) {
        if (!this.settable) throw new Error('property is not settable.');
        await this.propertyTransport.set(...this.parser.fromHomie(homieValue, this.propertyTransport.data));
    }
    async setHomieProperty(homieProperty) {
        await this.dropHomieProperty();
        if (!homieProperty) {
            this.homieProperty = null;

            return;
        }
        if (homieProperty.id !== this.id) throw new Error('Property id do not match homie property id.');
        this.homieProperty = homieProperty;
        // SET EVENT HANDLERS
        await this.start();
        // SET EVENT HANDLERS END
    }
    async dropHomieProperty() {
        if (this.homieProperty) {
            // DROP EVENT HANDLERS
            await this.stop();
            // DROP EVENT HANDLERS END
            this.homieProperty = null;
        }
    }
    tryPublishToHomie() {
        if (this.debug) this.debug.info('BaseProperty.tryPublishToHomie');
        clearTimeout(this._tryPublishToHomieTimeout);
        if (this.pendingHomieValue === null) return;
        if (this.homieProperty) {
            try {
                this.homieProperty.publishAttribute('value', this.pendingHomieValue);
            } catch (e) {
                this.emit('error', e);
            }
        }
        this._tryPublishToHomieTimeout = setTimeout(this.tryPublishToHomie.bind(this), 5000);
    }
    // HANDLERS
    async handlePropertyTransportDataChanged(data) {
        if (this.debug) this.debug.info('BaseProperty.handlePropertyTransportDataChanged', { data, typeof_data: (typeof data) });

        const homieValue = this.parser.toHomie(data);

        if (this.homieValue !== homieValue && this.pendingHomieValue !== homieValue) {
            this.pendingHomieValue = homieValue;
            this.tryPublishToHomie();
        }
    }
    async handleHomieAttributeSet(name, value) {
        if (this.debug) this.debug.info('BaseProperty.handleHomieAttributeSet', { name, value });
        if (!this.homieProperty) throw new Error('this.homieProperty is not set.');
        if (name === 'value') {
            try {
                await this.setValue(value);
            } catch (e) {
                this.debug.warning('BaseProperty.handleHomieAttributeSet', e);
                this.homieProperty.publishError({ code: 'ERROR', message: e.message });
            }
        }
    }
    async handleHomieAttributePublish(name, value) {
        if (!this.homieProperty) throw new Error('this.homieProperty is not set.');
        if (name === 'value') {
            if (value === this.pendingHomieValue) {
                this.pendingHomieValue = null;
                this.homieValue = value;
                clearTimeout(this._tryPublishToHomieTimeout);
            }
        }
    }
    async handleErrorPropagate(error) {
        error.property = { id: this.id };
        this.emit('error', error);
    }
    // HANDLERS END
}

module.exports = BaseProperty;
