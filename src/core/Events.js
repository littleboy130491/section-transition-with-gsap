export class Events {
  constructor(globalEvents = {}, localEvents = {}, onError = null) {
    this.globalEvents = globalEvents || {};
    this.localEvents = localEvents || {};
    this.onError = onError;
  }

  emit(name, context) {
    const handlers = [this.globalEvents[name], this.localEvents[name]].filter(
      (fn) => typeof fn === "function"
    );

    handlers.forEach((fn) => {
      try {
        fn(context);
      } catch (error) {
        if (typeof this.onError === "function") {
          this.onError(error, { ...context, phase: `event:${name}` });
        } else {
          console.error(error);
        }
      }
    });
  }
}
