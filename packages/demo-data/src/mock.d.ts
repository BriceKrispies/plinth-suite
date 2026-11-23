/** Options for {@link installDemo}. */
export interface DemoOptions {
  /** The Classic app's base path (recordings are served at `<base>demo-data/`). Default "/". */
  readonly base?: string;
  /** Where the recordings are, when not `<base>demo-data/`. */
  readonly dataUrl?: string;
  /** The persona to serve; default from `?as=`, then the manifest's default persona. */
  readonly persona?: string;
}

/** Patch `fetch` for `/api/` and `WebSocket` for `/rt`; resolves once the recordings are loaded. */
export declare const installDemo: (options?: DemoOptions) => Promise<void>;

/** True once `installDemo` ran in this page. */
export declare const isDemo: () => boolean;
