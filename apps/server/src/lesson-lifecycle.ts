import { type CourseBlueprint, type LessonRef, offlineLesson } from '@eduharness-studio/engine';
import {
  CourseLessonPlanningError,
  createCourseLessonPlanner,
  isLiveLessonMaterial,
  type LessonMaterial,
} from '@eduharness-studio/engine/course';
import { type ModelGateway, ModelGenerationError } from '@eduharness-studio/engine/models';
import type { TeacherTool } from '@eduharness-studio/engine/teacher';
import { type CourseStore, isDemoCourse } from './course-store.js';
import type { sessionDatabase } from './session-db.js';
import { createSessionLocks, teacherTurnBusy } from './session-lock.js';

export type LessonLifecycle = ReturnType<typeof createLessonLifecycle>;
export type PreparedLesson = LessonMaterial | typeof teacherTurnBusy;

export function generationFailure(error: unknown) {
  if (error instanceof ModelGenerationError) {
    return { failure: error.code, ...(error.reasons.length ? { reasons: error.reasons } : {}) };
  }
  if (error instanceof CourseLessonPlanningError) {
    return { failure: error.code, reasons: error.reasons };
  }
  return { failure: 'generation_failed' };
}

export function createLessonLifecycle(
  courses: CourseStore,
  store: ReturnType<typeof sessionDatabase>,
  gateway: ModelGateway,
  tools?: readonly TeacherTool[],
) {
  const planLesson = createCourseLessonPlanner(gateway, undefined, tools);
  const locks = createSessionLocks(store);
  const inFlight = new Map<string, Promise<PreparedLesson>>();

  async function prepare(course: CourseBlueprint, lesson: LessonRef): Promise<PreparedLesson> {
    const live = !isDemoCourse(course.id) && (await gateway.getStatus()).mode === 'live';
    const offline = () => ({ script: offlineLesson(course, lesson) });
    if (!live && lesson.status !== 'locked') return offline();

    const cachedLive = () => {
      const saved = courses.material(course.id, lesson.id);
      return isLiveLessonMaterial(saved) ? saved : undefined;
    };
    const cached = live ? cachedLive() : undefined;
    if (cached) return cached;

    const scope = `lesson-material:${course.id}/${lesson.id}`;
    const key = `${scope}:${live ? 'live' : 'offline'}`;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const result = locks.run(scope, async ({ scope, token }) => {
      const saved = live ? cachedLive() : undefined;
      if (saved) return saved;
      const material = live
        ? (
            await planLesson({
              course,
              lesson,
              previousKeypoints: courses.previousKeypoints(course.id, lesson.id),
            })
          ).material
        : offline();
      const persisted = courses.saveMaterial(course.id, lesson.id, material, () =>
        store.ownsTeacherLock(scope, token),
      );
      return persisted ? material : teacherTurnBusy;
    });
    inFlight.set(key, result);
    try {
      return await result;
    } finally {
      inFlight.delete(key);
    }
  }

  async function unlock(course: CourseBlueprint, lesson: LessonRef) {
    const ready = { lessonId: lesson.id, status: 'ready' as const };
    if (
      lesson.status !== 'locked' &&
      store.readTransaction(
        () => store.latest(course.id, lesson.id) || store.hasUnversioned(course.id, lesson.id),
      )
    ) {
      return ready;
    }
    const result = await prepare(course, lesson);
    return 'error' in result ? result : ready;
  }

  return { prepare, unlock };
}
