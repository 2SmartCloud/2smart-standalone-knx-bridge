module.exports = {
    create(config) {
        if (config.type === 'index') throw new Error('Bad transport type.');
        const TransportClass = require(`./${config.type}`);

        return new TransportClass(config);
    }
};
