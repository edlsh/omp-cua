// Compile-time host contract: the loader needs no unsafe API cast.
import type { ExtensionAPI as OmpAPI } from "@oh-my-pi/pi-coding-agent";
import type { DesktopAPI } from "../src/host.ts";

type Assert<T extends true> = T;
export type OmpHost = Assert<OmpAPI extends DesktopAPI ? true : false>;
