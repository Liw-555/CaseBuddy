import { useState, useRef, useEffect } from 'react';
import { Scale, Upload, FileText, Trash2, Sparkles, CheckCircle, AlertCircle, Loader2, Download, History, ChevronLeft, X, Send } from 'lucide-react';

const API_BASE = 'http://localhost:3001';

interface PptFile {
  name: string;
  size: number;
  file: File;
}

interface HistorySummary {
  id: string;
  timestamp: string;
  caseBuddyFileName: string;
  awardFileName: string;
  overallScore: number;
  dimensions: { name: string; caseBuddyScore: number; awardScore: number }[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
}

interface HistoryDetail extends HistorySummary {
  fullReport: string;
}

interface CompareResult {
  overallScore: number;
  dimensions: { name: string; caseBuddyScore: number; awardScore: number; comment: string; suggestions: string[] }[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  fullReport: string;
}

export default function PPTCompare() {
  const [caseBuddyFile, setCaseBuddyFile] = useState<PptFile | null>(null);
  const [awardFile, setAwardFile] = useState<PptFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [view, setView] = useState<'compare' | 'history'>('compare');
  const [historyList, setHistoryList] = useState<HistorySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryDetail | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [wxPushing, setWxPushing] = useState(false);
  const [wxPushMsg, setWxPushMsg] = useState<string | null>(null);
  const caseBuddyRef = useRef<HTMLInputElement>(null);
  const awardRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (type: 'casebuddy' | 'award') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['ppt', 'pptx'].includes(ext || '')) {
      setError('仅支持 PPT/PPTX 格式');
      return;
    }
    const pptFile: PptFile = { name: file.name, size: file.size, file };
    if (type === 'casebuddy') setCaseBuddyFile(pptFile);
    else setAwardFile(pptFile);
    setError(null);
    setResult(null);
    // Reset file input
    e.target.value = '';
  };

  const removeFile = (type: 'casebuddy' | 'award') => {
    if (type === 'casebuddy') {
      setCaseBuddyFile(null);
    } else {
      setAwardFile(null);
    }
    setResult(null);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // 加载历史记录
  useEffect(() => {
    if (view === 'history') {
      loadHistory();
    }
  }, [view]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ppt-compare/history`);
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      }
    } catch (e) {
      console.error('加载历史记录失败:', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const viewHistoryDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/ppt-compare/history/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedHistory(data);
        setSelectedHistoryId(id);
      }
    } catch (e) {
      console.error('加载历史详情失败:', e);
    }
  };

  const deleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定删除此条记录？')) return;
    try {
      const res = await fetch(`${API_BASE}/api/ppt-compare/history/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setHistoryList((prev) => prev.filter((h) => h.id !== id));
        if (selectedHistoryId === id) {
          setSelectedHistory(null);
          setSelectedHistoryId(null);
        }
      }
    } catch (e) {
      console.error('删除历史记录失败:', e);
    }
  };

  const startCompare = async () => {
    if (!caseBuddyFile || !awardFile) {
      setError('请先上传两个 PPT 文件');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Step 1: Upload and parse both PPTs
      const formData = new FormData();
      formData.append('casebuddy', caseBuddyFile.file);
      formData.append('award', awardFile.file);

      const parseRes = await fetch(`${API_BASE}/api/ppt-compare/parse`, {
        method: 'POST',
        body: formData,
      });

      if (!parseRes.ok) {
        const err = await parseRes.json();
        throw new Error(err.error || '解析 PPT 失败');
      }

      const { caseBuddyText, awardText } = await parseRes.json();

      // Step 2: Call LLM for comparison
      const compareRes = await fetch(`${API_BASE}/api/ppt-compare/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseBuddyText,
          awardText,
          caseBuddyFileName: caseBuddyFile.name,
          awardFileName: awardFile.name,
        }),
      });

      if (!compareRes.ok) {
        const err = await compareRes.json();
        throw new Error(err.error || '对比分析失败');
      }

      const data = await compareRes.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!result) return;
    const blob = new Blob([result.fullReport], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PPT对比分析报告_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const GW_BASE = 'http://localhost:3002';

  const pushToWechat = async () => {
    if (!result) return;
    setWxPushing(true);
    setWxPushMsg(null);
    try {
      // 构造推送内容摘要
      const summary = `【PPT 对比分析报告】\n评分: ${result.overallScore}/10\n\n优势:\n${(result.strengths || []).join('\n')}\n\n待改进:\n${(result.weaknesses || []).join('\n')}\n\n改进建议:\n${(result.suggestions || []).join('\n')}\n\n完整报告:\n${result.fullReport?.slice(0, 3000)}${(result.fullReport?.length > 3000 ? '\n... (完整报告请在网页查看)' : '')}`;

      const res = await fetch(`${GW_BASE}/push-wechat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: summary }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        setWxPushMsg('推送成功');
      } else {
        setWxPushMsg(data.error || data.message || '推送失败');
      }
    } catch (err) {
      setWxPushMsg(err instanceof Error ? err.message : '推送失败');
    } finally {
      setWxPushing(false);
      setTimeout(() => setWxPushMsg(null), 3000);
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-3">
              <Scale className="w-7 h-7 text-accent-500" />
              PPT 对比分析
            </h1>
            {/* View Tabs */}
            <div className="flex bg-surface-100 rounded-lg p-1 gap-1">
              <button
                onClick={() => { setView('compare'); setResult(null); setError(null); }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  view === 'compare'
                    ? 'bg-white text-surface-900 shadow-sm'
                    : 'text-surface-500 hover:text-surface-700'
                }`}
              >
                对比分析
              </button>
              <button
                onClick={() => { setView('history'); setSelectedHistory(null); setError(null); }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${
                  view === 'history'
                    ? 'bg-white text-surface-900 shadow-sm'
                    : 'text-surface-500 hover:text-surface-700'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                历史记录
              </button>
            </div>
          </div>
          <p className="text-surface-600 mt-2">
            上传 CaseBuddy 生成的 PPT 和获奖优质 PPT，AI 将从多维度对比分析并给出改进建议
          </p>
        </div>

        {view === 'compare' && (<>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-lg flex items-center gap-3 bg-rose-50 text-rose-800 border border-rose-200">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Upload Area */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* CaseBuddy PPT */}
          <div className="bg-white rounded-xl border border-surface-200 p-6">
            <h3 className="text-sm font-semibold text-surface-700 mb-1">CaseBuddy 生成 PPT</h3>
            <p className="text-xs text-surface-500 mb-4">上传 CaseBuddy 案例分析生成的 PPT 文件</p>
            {caseBuddyFile ? (
              <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg border border-primary-200">
                <FileText className="w-8 h-8 text-primary-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-surface-800 truncate">{caseBuddyFile.name}</p>
                  <p className="text-xs text-surface-500">{formatSize(caseBuddyFile.size)}</p>
                </div>
                <button onClick={() => removeFile('casebuddy')} className="text-rose-400 hover:text-rose-600 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => caseBuddyRef.current?.click()}
                className="w-full border-2 border-dashed border-surface-300 rounded-lg p-8 flex flex-col items-center gap-2 hover:border-primary-400 hover:bg-primary-50/50 transition-colors"
              >
                <Upload className="w-8 h-8 text-surface-400" />
                <span className="text-sm text-surface-600 font-medium">点击上传 PPT 文件</span>
                <span className="text-xs text-surface-400">支持 .ppt / .pptx 格式</span>
              </button>
            )}
            <input ref={caseBuddyRef} type="file" accept=".ppt,.pptx" className="hidden" onChange={handleFileSelect('casebuddy')} />
          </div>

          {/* Award PPT */}
          <div className="bg-white rounded-xl border border-surface-200 p-6">
            <h3 className="text-sm font-semibold text-surface-700 mb-1">获奖优质 PPT</h3>
            <p className="text-xs text-surface-500 mb-4">上传获奖的优质案例分析 PPT 作为对标</p>
            {awardFile ? (
              <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <FileText className="w-8 h-8 text-amber-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-surface-800 truncate">{awardFile.name}</p>
                  <p className="text-xs text-surface-500">{formatSize(awardFile.size)}</p>
                </div>
                <button onClick={() => removeFile('award')} className="text-rose-400 hover:text-rose-600 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => awardRef.current?.click()}
                className="w-full border-2 border-dashed border-surface-300 rounded-lg p-8 flex flex-col items-center gap-2 hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
              >
                <Upload className="w-8 h-8 text-surface-400" />
                <span className="text-sm text-surface-600 font-medium">点击上传 PPT 文件</span>
                <span className="text-xs text-surface-400">支持 .ppt / .pptx 格式</span>
              </button>
            )}
            <input ref={awardRef} type="file" accept=".ppt,.pptx" className="hidden" onChange={handleFileSelect('award')} />
          </div>
        </div>

        {/* Compare Button */}
        <div className="flex justify-center mb-8">
          <button
            onClick={startCompare}
            disabled={!caseBuddyFile || !awardFile || loading}
            className="px-8 py-3 bg-gradient-to-r from-accent-500 to-primary-500 hover:from-accent-600 hover:to-primary-600 text-white rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium text-sm shadow-lg shadow-accent-500/25"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                AI 正在对比分析中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                开始对比分析
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-6 animate-fade-in-scale">
            {/* Overall Score */}
            <div className="bg-white rounded-xl border border-surface-200 p-6">
              <h2 className="text-lg font-bold text-surface-900 mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                对比分析结果
              </h2>
              <div className="flex items-center gap-8 mb-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary-600">{result.overallScore}</div>
                  <div className="text-xs text-surface-500 mt-1">综合评分</div>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-primary-50 rounded-lg">
                    <div className="text-sm font-semibold text-primary-700">{caseBuddyFile?.name.replace(/\.(ppt|pptx)$/i, '')}</div>
                    <div className="text-xs text-surface-500">待改进 PPT</div>
                  </div>
                  <div className="text-center p-3 bg-amber-50 rounded-lg">
                    <div className="text-sm font-semibold text-amber-700">{awardFile?.name.replace(/\.(ppt|pptx)$/i, '')}</div>
                    <div className="text-xs text-surface-500">获奖对标 PPT</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Dimension Scores */}
            <div className="bg-white rounded-xl border border-surface-200 p-6">
              <h3 className="text-base font-semibold text-surface-900 mb-4">各维度对比</h3>
              <div className="space-y-4">
                {result.dimensions.map((dim, idx) => (
                  <div key={idx} className="border border-surface-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-surface-800">{dim.name}</h4>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-primary-600">CaseBuddy: {dim.caseBuddyScore}/10</span>
                        <span className="text-amber-600">获奖: {dim.awardScore}/10</span>
                      </div>
                    </div>
                    {/* Score bars */}
                    <div className="flex gap-2 mb-3">
                      <div className="flex-1">
                        <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all duration-500"
                            style={{ width: `${dim.caseBuddyScore * 10}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all duration-500"
                            style={{ width: `${dim.awardScore * 10}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-surface-600 mb-2">{dim.comment}</p>
                    {dim.suggestions.length > 0 && (
                      <div className="ml-4">
                        <p className="text-xs font-medium text-surface-700 mb-1">改进建议：</p>
                        <ul className="list-disc list-inside text-xs text-surface-600 space-y-0.5">
                          {dim.suggestions.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Strengths & Weaknesses */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-surface-200 p-6">
                <h3 className="text-base font-semibold text-green-700 mb-3 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  优势亮点
                </h3>
                <ul className="list-disc list-inside text-sm text-surface-700 space-y-1">
                  {result.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-white rounded-xl border border-surface-200 p-6">
                <h3 className="text-base font-semibold text-rose-700 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  待改进点
                </h3>
                <ul className="list-disc list-inside text-sm text-surface-700 space-y-1">
                  {result.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Suggestions */}
            <div className="bg-white rounded-xl border border-surface-200 p-6">
              <h3 className="text-base font-semibold text-surface-900 mb-3">改进方案</h3>
              <div className="space-y-2">
                {result.suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 bg-surface-50 rounded-lg">
                    <span className="w-5 h-5 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                    <span className="text-sm text-surface-700">{s}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Full Report */}
            <div className="bg-white rounded-xl border border-surface-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-surface-900">完整分析报告</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={pushToWechat}
                    disabled={wxPushing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {wxPushing ? '推送中...' : '推送到微信'}
                  </button>
                  {wxPushMsg && (
                    <span className={`text-xs ${wxPushMsg === '推送成功' ? 'text-green-600' : 'text-red-500'}`}>{wxPushMsg}</span>
                  )}
                  <button
                    onClick={exportReport}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    导出 Markdown
                  </button>
                </div>
              </div>
              <div className="prose prose-sm max-w-none text-surface-700 whitespace-pre-wrap font-sans leading-relaxed">
                {result.fullReport}
              </div>
            </div>
          </div>
        )}
        </>
        )}

        {/* History View */}
        {view === 'history' && (
          <div className="space-y-4">
            {/* Back to list when viewing detail */}
            {selectedHistory ? (
              <>
                <button
                  onClick={() => { setSelectedHistory(null); setSelectedHistoryId(null); }}
                  className="flex items-center gap-1.5 text-sm text-surface-600 hover:text-surface-900 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  返回历史列表
                </button>
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-bold text-surface-900">
                        {selectedHistory.caseBuddyFileName} vs {selectedHistory.awardFileName}
                      </h2>
                      <p className="text-xs text-surface-500 mt-1">
                        {new Date(selectedHistory.timestamp).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <div className="text-3xl font-bold text-primary-600">{selectedHistory.overallScore}</div>
                  </div>

                  {/* Dimensions */}
                  <h3 className="text-base font-semibold text-surface-900 mb-3">各维度评分</h3>
                  <div className="space-y-3 mb-6">
                    {selectedHistory.dimensions.map((dim, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-3 bg-surface-50 rounded-lg">
                        <span className="text-sm font-medium text-surface-700 w-36">{dim.name}</span>
                        <div className="flex-1 flex items-center gap-3">
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-primary-600">CaseBuddy</span>
                            <div className="w-16 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary-500 rounded-full"
                                style={{ width: `${dim.caseBuddyScore * 10}%` }}
                              />
                            </div>
                            <span className="font-medium">{dim.caseBuddyScore}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-amber-600">获奖</span>
                            <div className="w-16 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full"
                                style={{ width: `${dim.awardScore * 10}%` }}
                              />
                            </div>
                            <span className="font-medium">{dim.awardScore}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Strengths & Weaknesses */}
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                      <h4 className="text-sm font-semibold text-green-700 mb-2">优势亮点</h4>
                      <ul className="list-disc list-inside text-xs text-surface-600 space-y-1">
                        {selectedHistory.strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-rose-700 mb-2">待改进点</h4>
                      <ul className="list-disc list-inside text-xs text-surface-600 space-y-1">
                        {selectedHistory.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  </div>

                  {/* Full Report */}
                  {selectedHistory.fullReport && (
                    <div>
                      <h4 className="text-sm font-semibold text-surface-900 mb-2">完整报告</h4>
                      <div className="prose prose-sm max-w-none text-surface-700 whitespace-pre-wrap font-sans leading-relaxed p-4 bg-surface-50 rounded-lg">
                        {selectedHistory.fullReport}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {historyLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-surface-400" />
                  </div>
                ) : historyList.length === 0 ? (
                  <div className="bg-white rounded-xl border border-surface-200 p-12 text-center">
                    <History className="w-10 h-10 text-surface-300 mx-auto mb-3" />
                    <p className="text-surface-500 text-sm">暂无对比分析记录</p>
                    <button
                      onClick={() => setView('compare')}
                      className="mt-3 text-sm text-primary-600 hover:text-primary-700"
                    >
                      立即开始分析
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {historyList.map((record) => (
                      <div
                        key={record.id}
                        onClick={() => viewHistoryDetail(record.id)}
                        className="bg-white rounded-xl border border-surface-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3 mb-1">
                              <span className="text-sm font-semibold text-surface-800 truncate">
                                {record.caseBuddyFileName}
                              </span>
                              <span className="text-xs text-surface-400">vs</span>
                              <span className="text-sm font-semibold text-surface-800 truncate">
                                {record.awardFileName}
                              </span>
                            </div>
                            <p className="text-xs text-surface-500">
                              {new Date(record.timestamp).toLocaleString('zh-CN')}
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-2xl font-bold text-primary-600">
                              {record.overallScore}
                            </span>
                            <button
                              onClick={(e) => deleteHistory(record.id, e)}
                              className="p-1.5 text-surface-400 hover:text-rose-500 transition-colors"
                              title="删除"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
