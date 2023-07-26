// if you need a previous homieData value and data of another source - save here.
class BaseParser {
    constructor(conf) {
        conf = (conf === undefined) ? {} : (typeof conf === 'string') ? { type: conf } : conf;

        this.type = conf.type;
        this.homieDataType = conf.homieDataType || this.type;
    }
    /*
    * fromHomie(data) - converts homie value to source data type
    * data = homie value(typeof data = 'string')
    *
    * returns
    * Array of arguments to transport, first argument must be transport value, other - any other transport arguments
    * */
    // eslint-disable-next-line no-unused-vars
    fromHomie(data) {
        throw new Error('Abstract method BaseParser.fromHomie.');
    }
    /*
    * toHomie(data) - converts source data type to homie value(typeof data = 'string')
    * data = any data of source data format
    *
    * returns
    * homie value(typeof data = 'string')
    * */
    // eslint-disable-next-line no-unused-vars
    toHomie(data) {
        throw new Error('Abstract method BaseParser.toHomie.');
    }
}
BaseParser.create =  function (dataType) {
    let className = dataType;

    if (typeof className === 'object') className = className.type;
    const ParserClass = require(`./${className}`);

    return new ParserClass(dataType);
};

module.exports = BaseParser;
