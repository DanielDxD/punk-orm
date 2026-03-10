export class Logger {
    private static readonly colors = {
        reset: "\x1b[0m",
        white: "\x1b[37m",
        yellow: "\x1b[33m",
        green: "\x1b[32m",
        red: "\x1b[31m",
        blue: "\x1b[34m",
        dim: "\x1b[2m"
    };

    private static format(content: any, color: string, context?: string): string {
        const timestamp = new Date().toLocaleTimeString();
        const ctxPrefix = context ? `[${context}] ` : "";
        const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
        return `${this.colors.white}[${timestamp}] ${this.colors.reset}${color}${ctxPrefix}${text}${this.colors.reset}`;
    }

    public static logAny(content: any, context?: string) {
        console.log(this.format(content, this.colors.white, context));
    }

    public static log(content: string, context?: string) {
        console.log(this.format(content, this.colors.white, context));
    }

    public static warn(content: string, context?: string) {
        console.log(this.format(content, this.colors.yellow, context));
    }

    public static success(content: string, context?: string) {
        console.log(this.format(content, this.colors.green, context));
    }

    public static error(content: string, context?: string) {
        console.log(this.format(content, this.colors.red, context));
    }

    public static info(content: string, context?: string) {
        console.log(this.format(content, this.colors.blue, context));
    }

    public static debug(content: any, context?: string) {
        console.log(this.format(content, this.colors.dim, context));
    }
}
