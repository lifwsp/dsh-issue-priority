export class GitHubAdapterError extends Error {
    code;
    status;
    constructor(message, code, status) {
        super(message);
        this.name = 'GitHubAdapterError';
        this.code = code;
        this.status = status;
    }
}
//# sourceMappingURL=adapter.js.map