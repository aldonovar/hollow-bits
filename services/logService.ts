
import { desktopRuntimeService } from './desktopRuntimeService';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  data?: any;
}

class LogService {
  private static instance: LogService;
  private isDesktop: boolean;

  private constructor() {
    this.isDesktop = desktopRuntimeService.isDesktop;
  }

  public static getInstance(): LogService {
    if (!LogService.instance) {
      LogService.instance = new LogService();
    }
    return LogService.instance;
  }

  private formatMessage(entry: LogEntry): string {
    const contextStr = entry.context ? `[${entry.context}] ` : '';
    return `${entry.timestamp} ${entry.level.toUpperCase()} ${contextStr}${entry.message}`;
  }

  private async processLog(level: LogLevel, message: string, context?: string, data?: any) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      data
    };

    const formatted = this.formatMessage(entry);

    // Console output
    switch (level) {
      case 'info':
        console.log(formatted, data || '');
        break;
      case 'warn':
        console.warn(formatted, data || '');
        break;
      case 'error':
        console.error(formatted, data || '');
        break;
      case 'debug':
        console.debug(formatted, data || '');
        break;
    }

    // Desktop IPC output (for file logging)
    if (this.isDesktop && (window as any).electron?.log) {
      try {
        (window as any).electron.log(entry);
      } catch (err) {
        // Silently fail
      }
    }
  }

  public info(message: string, context?: string, data?: any) {
    void this.processLog('info', message, context, data);
  }

  public warn(message: string, context?: string, data?: any) {
    void this.processLog('warn', message, context, data);
  }

  public error(message: string, context?: string, data?: any) {
    void this.processLog('error', message, context, data);
  }

  public debug(message: string, context?: string, data?: any) {
    void this.processLog('debug', message, context, data);
  }
}

export const logService = LogService.getInstance();
