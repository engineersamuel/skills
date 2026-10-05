export type UpdateMessage<T> = {
  readonly kind: "snapshot" | "update";
  readonly revision: number;
  readonly value: T;
};

export class UpdateHub<T> {
  readonly #token: string;
  readonly #schedule: (run: () => void, delayMs: number) => void;
  readonly #subscribers = new Set<(message: UpdateMessage<T>) => void>();
  #value: T;
  #revision = 0;
  #scheduled = false;

  constructor(
    token: string,
    initial: T,
    schedule: (run: () => void, delayMs: number) => void,
  ) {
    this.#token = token;
    this.#value = initial;
    this.#schedule = schedule;
  }

  connect(token: string, send: (message: UpdateMessage<T>) => void): boolean {
    if (token !== this.#token) {
      return false;
    }
    this.#subscribers.add(send);
    send({ kind: "snapshot", revision: this.#revision, value: this.#value });
    return true;
  }

  disconnect(send: (message: UpdateMessage<T>) => void): void {
    this.#subscribers.delete(send);
  }

  publish(value: T): void {
    this.#value = value;
    this.#revision += 1;
    if (this.#scheduled) {
      return;
    }
    this.#scheduled = true;
    this.#schedule(() => {
      this.#scheduled = false;
      const message: UpdateMessage<T> = {
        kind: "update",
        revision: this.#revision,
        value: this.#value,
      };
      for (const send of this.#subscribers) {
        send(message);
      }
    }, 150);
  }
}
