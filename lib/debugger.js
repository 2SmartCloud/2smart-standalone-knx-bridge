const EventEmitter = require('events');

class Debugger extends EventEmitter {
    constructor() {
        super();
        this.send = this.send.bind(this);
        this.ignore_hash = {};
    }
    send(address, message) {
        if (this.isIgnored(address)) return;
        const subroutines = address.split('.');

        this.emit('*', address, message);
        // eslint-disable-next-line more/no-c-like-loops
        for (let i=1; i<=subroutines.length; i++) {
            this.emit(`${subroutines.slice(0, i).join('.')}.*`, address, message);
        }
        this.emit(address, message);
    }
    ignore(address) {
        this.ignore_hash[address] = true;
    }
    isIgnored(address) {
        const subroutines = address.split('.');

        // eslint-disable-next-line more/no-c-like-loops
        for (let i=0; i<=subroutines.length; i++) {
            if ((`${subroutines.slice(0, i).join('.')}.*`) in this.ignore_hash) return true;
        }
        return false;
    }
}
module.exports = Debugger;
