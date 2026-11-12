/**
 * On-screen diagnostics for devices we cannot attach a debugger to. Off unless the address has ?diag.
 * Shows device and GPU facts, what the AR session granted, what the floor search sees, and the last errors,
 * so a screenshot of it says why something does not work.
 */
export class Diag {
  private el = document.createElement('pre');
  private fields = new Map<string, string>();
  private lines: string[] = [];
  private last = 0;

  constructor() {
    this.el.id = 'diag';
    document.body.appendChild(this.el);
    this.hook();
    this.render();
  }

  /** The AR overlay is the only part of the page visible during AR, so the panel moves into it. */
  mount(parent: HTMLElement) { parent.appendChild(this.el); }

  set(key: string, value: string | number | boolean) { this.fields.set(key, String(value)); }

  log(message: string) {
    this.lines.push(`${(performance.now() / 1000).toFixed(1)}s ${message}`.slice(0, 150));
    if (this.lines.length > 6) this.lines.shift();
  }

  /** Redraw at most 4 times a second. */
  tick(nowMs: number) {
    if (nowMs - this.last < 250) return;
    this.last = nowMs;
    this.render();
  }

  private render() {
    const fields = [...this.fields].map(([k, v]) => `${k}: ${v}`).join('\n');
    this.el.textContent = this.lines.length ? `${fields}\n--\n${this.lines.join('\n')}` : fields;
  }

  private hook() {
    addEventListener('error', (e) => this.log(`ERR ${e.message}`));
    addEventListener('unhandledrejection', (e) => this.log(`REJ ${String(e.reason)}`));
    for (const level of ['error', 'warn'] as const) {
      const original = console[level];
      console[level] = (...args: unknown[]) => {
        this.log(`${level.toUpperCase()} ${args.map(String).join(' ')}`);
        original.apply(console, args);
      };
    }
  }
}
