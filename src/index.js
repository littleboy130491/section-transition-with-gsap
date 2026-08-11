import { normalizeOptions } from "./core/Config.js";
import { Manager } from "./core/Manager.js";
import { registerGSAP } from "./core/GSAPAdapter.js";

export const SectionTransition = {
  version: "0.6.0",

  useGSAP(gsap, ScrollTrigger) {
    registerGSAP(gsap, ScrollTrigger);
    return this;
  },

  async init(userOptions = {}) {
    const options = normalizeOptions(userOptions);

    if (!options.transitions || typeof options.transitions !== "object") {
      throw new Error("[SectionTransition] init() requires a transitions object");
    }

    const manager = new Manager(options);
    return await manager.init();
  }
};

if (typeof window !== "undefined") {
  window.SectionTransition = SectionTransition;
}
