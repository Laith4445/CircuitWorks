import type { ExerciseFile } from './check';
import E1 from './E1.json';
import E2 from './E2.json';
import E3 from './E3.json';
import E4 from './E4.json';
import E5 from './E5.json';
import E6 from './E6.json';
import E7 from './E7.json';

export const EXERCISES: ExerciseFile[] = [E1, E2, E3, E4, E5, E6, E7] as unknown as ExerciseFile[];
export { runExercise } from './check';
export type { ExerciseFile, ExerciseReport, CheckRow } from './check';
