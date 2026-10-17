"use client";

import { createContext, useContext } from "react";
import { subjectWords } from "@/lib/buildings";

/**
 * Which building the exterior editor is on (2026-10-16, lib/buildings.ts): null for the house, else the other
 * building's name - so the words that name what is being measured say "the shed" on the shed, and every word on
 * the house is as it always was.
 */
export const ExteriorSubjectContext = createContext<string | null>(null);

/** The building being measured: its name (null for the house), and the words for it in a sentence ("the shed"). */
export function useExteriorSubject(): { name: string | null; the: string; isHouse: boolean } {
  const name = useContext(ExteriorSubjectContext);
  return { name, the: subjectWords(name), isHouse: name === null };
}
