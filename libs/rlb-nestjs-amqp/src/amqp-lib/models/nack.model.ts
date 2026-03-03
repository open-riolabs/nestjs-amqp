export class Nack {
  constructor(private readonly _requeue: boolean = false) { }

  get requeue() {
    return this._requeue;
  }
}