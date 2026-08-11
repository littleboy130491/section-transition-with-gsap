import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SectionTransition } from "../src/index.js";
SectionTransition.useGSAP(gsap, ScrollTrigger);
export { SectionTransition };
