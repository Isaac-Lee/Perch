import { isTauri } from "./backend";
import { useMockDesk } from "../mock/useMockDesk";
import { useTauriDesk } from "./useTauriDesk";

export const useDesk = isTauri ? useTauriDesk : useMockDesk;
