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
export { buildInterruptQueue, classifyInterrupt } from './interrupt-scripts.js';
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
export type { ModelSettings, ModelStatus } from './model-protocol.js';
export {
  evaluateOfflineQuality,
  type OfflineQualityReport,
  type SessionQuality,
} from './offline-gate.js';
export {
  emptyOfflineAnswers,
  OFFLINE_DIMENSION_IDS,
  OFFLINE_DIMENSIONS,
  OFFLINE_QUESTION_IDS,
  type OfflineQuestion,
  scoreOfflineAnswers,
} from './offline-rubric.js';
export { offlineLesson } from './offline-scripts.js';
export {
  type DialogueEvent,
  type PlayedDialogue,
  type PublicDialogueTurn,
  projectActionsToPublicDialogue,
  projectPlayedDialogue,
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
export type {
  InterruptIntent,
  LessonEnd,
  LessonRecord,
  LessonTraceSpan,
  PlaybackProgressResult,
  PlaybackWriteReceipt,
  SessionSnapshot,
  SessionTrace,
} from './session-protocol.js';
export {
  LessonEndSchema,
  LessonRecordSchema,
  readLessonEnd,
  SessionSnapshotSchema,
} from './session-protocol.js';
export {
  canTransition,
  type InterruptResult,
  stateAfterBeat,
  type TeachingState,
  type TeachingTransition,
  truncateOnInterrupt,
} from './state.js';
export { sanitizeSvg } from './static-svg.js';
