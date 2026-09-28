/** Value strings ("4.7k", "10u", "3.3mH") -> numbers. Lives in the engine so it is Node-testable. */
export { parseValue, describeValue, formatSI } from '../engine/units';
