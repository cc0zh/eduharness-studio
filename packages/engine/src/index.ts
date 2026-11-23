export { type CourseSummary, generateBlueprint, type LessonEntry } from './blueprints.js';
export { BAYES_DEMO_ID, demoCourses, TRANSFORMER_DEMO_ID } from './demo-courses.js';
export {
  type Foundation,
  type FoundationStep,
  type GoalStep,
  INTAKE_LIMITS,
  type IntakeAnswers,
  IntakeGenerateSchema,
  type IntakeNext,
  IntakeNextSchema,
  IntakeStartSchema,
  nextIntake,
  startIntake,
} from './intake.js';
export {
  type LessonBeat,
  type LessonMetadata,
  type LessonScript,
  LessonScriptSchema,
  projectKeypointProgress,
  readCurrentLessonBeat,
  readLessonBeat,
  readLessonGeneration,
  validateLessonScript,
} from './lesson-playback.js';
export { offlineLesson } from './offline-scripts.js';
export {
  type DialogueEvent,
  type PublicDialogueTurn,
  projectActionsToPublicDialogue,
} from './projection.js';
export {
  type Action,
  type ActionBatch,
  ActionBatchSchema,
  type ActionKind,
  ActionSchema,
  AskActionSchema,
  BoardActionSchema,
  type CourseBlueprint,
  CourseBlueprintSchema,
  type DepthTag,
  DepthTagSchema,
  GraphActionSchema,
  GraphDiagramSchema,
  HighlightActionSchema,
  type Keypoint,
  KeypointCompleteActionSchema,
  KeypointSchema,
  type LessonRef,
  LessonRefSchema,
  NewColumnActionSchema,
  NewPageActionSchema,
  PROTOCOL_VERSION,
  SpeakActionSchema,
  type Unit,
  UnitSchema,
  validateActions,
  validateBlueprint,
} from './protocol.js';
export {
  canTransition,
  type InterruptResult,
  type TeachingState,
  truncateOnInterrupt,
} from './state.js';
export { sanitizeSvg } from './static-svg.js';
