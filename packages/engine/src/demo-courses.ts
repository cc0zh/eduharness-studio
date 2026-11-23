import { assembleBlueprint } from './blueprints.js';
import type { CourseBlueprint } from './protocol.js';

export const demoCourses: readonly CourseBlueprint[] = [
  assembleBlueprint(
    {
      id: 'demo-point-line-distance',
      topic: '几何推理',
      title: '点到直线的距离',
    },
    [
      {
        title: '从图形到坐标',
        lessons: [
          {
            title: '在坐标里找垂距',
            summary: '当边 AD 在 x = 0 上，为什么斜着的 AE 不是点 E 到 AD 的距离？',
            depth: 'intuition',
          },
          {
            title: '找到垂足再计算',
            summary: '写出垂足的坐标，用坐标差验证判断。',
            depth: 'derivation',
          },
        ],
      },
      {
        title: '换一条直线',
        lessons: [
          {
            title: '把垂距方法迁移到斜线',
            summary: '直线不再平行坐标轴时，哪些推理步骤还能保留？',
            depth: 'application',
          },
        ],
      },
    ],
  ),
  assembleBlueprint(
    {
      id: 'demo-http-cache',
      topic: 'Web 技术',
      title: 'HTTP 缓存：为什么不用重下？',
    },
    [
      {
        title: '一次访问，两种判断',
        lessons: [
          {
            title: '浏览器什么时候复用资源？',
            summary: '从刷新同一张图片出发，区分“还能用”和“先去问服务器”。',
            depth: 'intuition',
          },
          {
            title: '过期后如何问服务器',
            summary: '沿着 ETag 与 304 走一遍条件请求。',
            depth: 'definition',
          },
        ],
      },
      {
        title: '给资源制定缓存策略',
        lessons: [
          {
            title: '区分入口页面和静态资源',
            summary: '根据更新频率，为两类资源选不同的缓存时长。',
            depth: 'application',
          },
          {
            title: '解释一次缓存失效',
            summary: '沿着响应头和资源版本，追踪旧内容为何出现。',
            depth: 'application',
          },
        ],
      },
    ],
  ),
];
