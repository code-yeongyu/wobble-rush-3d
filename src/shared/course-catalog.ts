/**
 * The course catalog: every course the game can load.
 */

import { SUNRISE_SCRAMBLE } from "./sunrise-scramble"
import type { CourseDefinition } from "./types"

/** Every course the game can load. One polished course for now. */
export const COURSES: readonly CourseDefinition[] = [SUNRISE_SCRAMBLE]
