import React from 'react';
import {AlertTriangle, RotateCcw} from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  {children: React.ReactNode},
  ErrorBoundaryState
> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {hasError: false, message: ''};
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'وقع خطأ غير متوقع فالتطبيق',
    };
  }

  override render() {
    if (this.state.hasError) {
      let friendlyText = this.state.message;
      if (this.state.message.includes('Missing or insufficient permissions')) {
        friendlyText = 'ما عندكش الصلاحية لهاد العملية فـ قاعدة البيانات. تأكد أنك مسجل الدخول بالحساب الصحيح.';
      }
      return (
        <div className="min-h-screen bg-[#0a0f1e] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-white/10 bg-[#11182c] p-6 text-right space-y-4">
            <div className="flex items-center gap-3 text-[#ff7a1a]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-bold">وقع مشكل تقني</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed break-words">
              {friendlyText}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff7a1a] px-4 py-3 text-sm font-bold text-[#0a0f1e] hover:bg-[#ff8d3b]"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إعادة تحميل التطبيق</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
