import { ConsoleSpanExporter, InMemorySpanExporter, NoopSpanExporter, OtlpHttpSpanExporter } from '@machvon/kernel';
import { exporterOf } from '../bootstrap';
import type { Config } from '../config/config';

function configWith(exporter: Config['telemetry']['exporter'], otlpEndpoint?: string): Config {
  return { telemetry: { exporter, otlpEndpoint, serviceName: 'machvon-api' } } as Config;
}

describe('exporterOf: the span exporter a configuration asks for', () => {
  it('drops spans when telemetry is switched off, which is the default, instead of keeping every request span in memory', () => {
    const exporter = exporterOf(configWith('none'), {});
    expect(exporter).toBeInstanceOf(NoopSpanExporter);
    expect(exporter).not.toBeInstanceOf(InMemorySpanExporter);
  });

  it('drops spans when the otlp exporter is asked for without an endpoint', () => {
    expect(exporterOf(configWith('otlp'), {})).toBeInstanceOf(NoopSpanExporter);
  });

  it('writes to the console or sends to the collector when asked to', () => {
    expect(exporterOf(configWith('console'), {})).toBeInstanceOf(ConsoleSpanExporter);
    expect(exporterOf(configWith('otlp', 'http://collector:4318'), {})).toBeInstanceOf(OtlpHttpSpanExporter);
  });

  it('lets a test replace the exporter', () => {
    const own = new InMemorySpanExporter();
    expect(exporterOf(configWith('none'), { exporter: own })).toBe(own);
  });
});
