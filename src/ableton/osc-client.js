// Promise-friendly wrapper around an OSC UDP port talking to AbletonOSC.
// AbletonOSC replies to "getter" queries on the SAME address you sent (handled by
// request()); update streams arrive on their own addresses via the "message" event.

import osc from "osc";
import { EventEmitter } from "node:events";
import { OSC } from "../config.js";

export class OscClient extends EventEmitter {
  /** @param {{host?:string, remotePort?:number, localPort?:number}} [opts] */
  constructor(opts = {}) {
    super();
    this.host = opts.host ?? OSC.host;
    this.remotePort = opts.remotePort ?? OSC.remotePort;
    this.localPort = opts.localPort ?? OSC.localPort;
    this._port = null;
  }

  /**
   * Open the UDP socket; resolves once it's ready. Builds a FRESH UDPPort every
   * call because osc.js doesn't re-emit "ready" on a reopened port (which would
   * hang a reconnect); the timeout is a backstop against the same.
   */
  open() {
    this._teardown();
    const port = new osc.UDPPort({
      localAddress: "0.0.0.0",
      localPort: this.localPort,
      remoteAddress: this.host,
      remotePort: this.remotePort,
      metadata: false, // args arrive/are sent as plain JS values
    });
    this._port = port;
    port.on("message", (msg) => {
      // msg = { address: string, args: any[] }
      this.emit("message", msg);
      this.emit(msg.address, msg.args);
    });
    port.on("error", (err) => this.emit("error", err));

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        port.off("ready", onReady);
        port.off("error", onError);
      };
      const onReady = () => { cleanup(); resolve(); };
      const onError = (err) => { cleanup(); reject(err); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("OSC socket open timed out"));
      }, 2000);
      port.once("ready", onReady);
      port.once("error", onError);
      port.open();
    });
  }

  close() {
    this._teardown();
  }

  /** Close the current port (if any) and drop its listeners. */
  _teardown() {
    if (this._port) {
      try {
        this._port.removeAllListeners();
        this._port.close();
      } catch {
        /* ignore */
      }
      this._port = null;
    }
  }

  /**
   * Fire-and-forget command.
   * @param {string} address
   * @param {...any} args
   */
  send(address, ...args) {
    if (this._port) this._port.send({ address, args });
  }

  /**
   * Send a query and wait for the reply on the same address.
   * @param {string} address
   * @param {any[]} [args]
   * @param {{timeout?:number}} [opts]
   * @returns {Promise<any[]>} the reply args
   */
  request(address, args = [], opts = {}) {
    const timeout = opts.timeout ?? 2000;
    return new Promise((resolve, reject) => {
      if (!this._port) {
        reject(new Error("OSC socket not open"));
        return;
      }
      const onReply = (replyArgs) => {
        clearTimeout(timer);
        resolve(replyArgs);
      };
      const timer = setTimeout(() => {
        this.off(address, onReply);
        reject(new Error(`Timed out after ${timeout}ms waiting for ${address}`));
      }, timeout);
      this.once(address, onReply);
      this._port.send({ address, args });
    });
  }
}
