const _ = require('underscore');
const BaseParser = require('./index');

class RawParser extends BaseParser {
    constructor(conf) {
        conf = (conf === undefined) ? {} : (typeof conf === 'string') ? { type: conf } : conf;
        super(_.defaults(_.clone(conf), {
            type : 'string'
        }));
    }
    fromHomie(data) {
        return [ data ];
    }
    toHomie(data) {
        return data;
    }
}

module.exports = RawParser;
