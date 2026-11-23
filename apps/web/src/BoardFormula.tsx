import { render } from 'katex';
import { useLayoutEffect, useRef } from 'react';
import 'katex/dist/katex.min.css';

export function BoardFormula({ formula }: { formula: string }) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    try {
      render(formula, element, { displayMode: true, trust: false, maxSize: 20, strict: 'error' });
    } catch {
      element.textContent = '此公式暂不可显示。';
    }
  }, [formula]);

  return (
    <div
      ref={container}
      className="mt-3 overflow-x-auto rounded-xl border border-primary/10 bg-primary-soft/25 px-3 text-center text-sm text-primary"
    />
  );
}
