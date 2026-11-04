export class Problem extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = new.target.name;
        this.status = status;
        this.code = code;
    }
}
