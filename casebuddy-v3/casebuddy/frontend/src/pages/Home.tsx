import { ArrowRight, Clock, Target, Zap, BookOpen, Layers, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

const features = [
  {
    icon: Clock,
    title: '5小时极限挑战',
    desc: '针对MBA案例分析大赛的限时场景，优化AI辅助工作流，从案例速读到PPT生成全流程加速。',
    color: 'text-primary-500',
    bg: 'bg-primary-50',
    border: 'border-primary-100',
  },
  {
    icon: Target,
    title: '智能框架匹配',
    desc: '自动识别案例特征，推荐SWOT、波特五力、价值链等最适合的分析框架组合。',
    color: 'text-accent-500',
    bg: 'bg-accent-50',
    border: 'border-accent-100',
  },
  {
    icon: Zap,
    title: '深度洞察生成',
    desc: '超越AI泛泛输出，提供跨行业类比、红队质疑、颠覆性假设等高质量分析视角。',
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-100',
  },
  {
    icon: BookOpen,
    title: 'Prompt工程管理',
    desc: '内置高质量Prompt模板库，记录迭代过程，自动生成AI使用说明报告。',
    color: 'text-emerald-500',
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
  },
  {
    icon: Layers,
    title: 'Skill插件系统',
    desc: '可扩展的技能插件，支持案例速读、数据可视化、答辩模拟等专业能力。',
    color: 'text-rose-500',
    bg: 'bg-rose-50',
    border: 'border-rose-100',
  },
  {
    icon: MessageCircle,
    title: '模拟答辩训练',
    desc: 'AI模拟评委提问，预测15-20个高概率问题，训练现场应变能力。',
    color: 'text-violet-500',
    bg: 'bg-violet-50',
    border: 'border-violet-100',
  },
];

export default function Home() {
  return (
    <div className="min-h-full">
      {/* Hero */}
      <div className="bg-gradient-to-br from-surface-900 via-surface-800 to-primary-900 text-white">
        <div className="max-w-6xl mx-auto px-6 md:px-8 py-16 md:py-24">
          <div className="flex items-center gap-2 mb-6 animate-message-in">
            <span className="px-3 py-1 bg-accent-500/20 text-accent-300 rounded-full text-sm font-medium border border-accent-500/30">
              AI Native
            </span>
            <span className="px-3 py-1 bg-primary-500/20 text-primary-300 rounded-full text-sm font-medium border border-primary-500/30">
              MVP v0.1
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight animate-message-in" style={{ animationDelay: '0.1s' }}>
            让 AI Agent 成为你的
            <span className="text-accent-400"> "超级外脑"</span>
          </h1>
          <p className="text-lg md:text-xl text-surface-300 mb-8 max-w-2xl leading-relaxed animate-message-in" style={{ animationDelay: '0.15s' }}>
            CaseBuddy 是专为 MBA 案例分析大赛设计的 AI 协同专家。
            在 5 小时极限挑战中，帮你完成从案例解构到洞察生成、从 PPT 制作到答辩准备的全流程。
          </p>
          <div className="flex flex-wrap gap-4 animate-message-in" style={{ animationDelay: '0.2s' }}>
            <Link
              to="/workbench"
              className="inline-flex items-center gap-2 px-6 py-3 bg-accent-500 hover:bg-accent-600
                text-white rounded-xl font-medium transition-all btn-press shadow-lg shadow-accent-500/25"
            >
              开始分析
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/skills"
              className="inline-flex items-center gap-2 px-6 py-3 bg-surface-700/80 hover:bg-surface-600
                text-white rounded-xl font-medium transition-all btn-press backdrop-blur"
            >
              探索技能
            </Link>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 md:px-8 py-16 md:py-20">
        <div className="mb-12">
          <h2 className="text-3xl font-bold text-surface-900 mb-3">核心能力</h2>
          <p className="text-surface-500 max-w-2xl">
            基于全国管理案例精英赛评分标准和获奖团队方法论，构建的 AI 辅助分析体系
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className={`bg-white rounded-xl p-6 border ${f.border} card-hover`}>
                <div className={`w-12 h-12 ${f.bg} rounded-xl flex items-center justify-center mb-4`}>
                  <Icon className={`w-6 h-6 ${f.color}`} />
                </div>
                <h3 className="font-semibold text-surface-900 mb-2">{f.title}</h3>
                <p className="text-sm text-surface-500 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Workflow */}
      <div className="bg-white border-y border-surface-200">
        <div className="max-w-6xl mx-auto px-6 md:px-8 py-16 md:py-20">
          <h2 className="text-3xl font-bold text-surface-900 mb-3">5小时工作流</h2>
          <p className="text-surface-500 mb-12">参考华东师大 One Day Case 比赛规则设计的限时分析流程</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { time: 'T+0:00', title: '案例速读', desc: 'AI提取时间线、决策点、关键数据', color: 'bg-primary-500', shadow: 'shadow-primary-500/20' },
              { time: 'T+0:15', title: '角度选择', desc: 'AI推荐5-8个分析角度', color: 'bg-accent-500', shadow: 'shadow-accent-500/20' },
              { time: 'T+0:35', title: '深度分析', desc: '框架应用+数据补充+洞察生成', color: 'bg-amber-500', shadow: 'shadow-amber-500/20' },
              { time: 'T+2:50', title: 'PPT制作', desc: '结构优化+可视化+故事线', color: 'bg-emerald-500', shadow: 'shadow-emerald-500/20' },
              { time: 'T+4:10', title: '答辩准备', desc: '问题预测+回答框架+排练', color: 'bg-rose-500', shadow: 'shadow-rose-500/20' },
            ].map((step, i) => (
              <div key={i} className="relative animate-message-in" style={{ animationDelay: `${i * 0.08}s` }}>
                <div className={`${step.color} text-white rounded-xl p-4 mb-3 shadow-lg ${step.shadow} transition-transform hover:-translate-y-0.5`}>
                  <div className="text-xs opacity-80 mb-1 font-medium">{step.time}</div>
                  <div className="font-semibold">{step.title}</div>
                </div>
                <p className="text-sm text-surface-500 px-1">{step.desc}</p>
                {i < 4 && (
                  <div className="hidden lg:block absolute top-6 -right-3 text-surface-300">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Test Case */}
      <div className="max-w-6xl mx-auto px-6 md:px-8 py-16 md:py-20">
        <div className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-2xl p-6 md:p-8 border border-primary-100 card-hover">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <div className="w-16 h-16 bg-primary-500 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-primary-500/20">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-surface-900 mb-2">测试案例：亿航智能</h3>
              <p className="text-surface-600 mb-4 leading-relaxed">
                《御风拏云：亿航智能从技术破壁到场景裂变的技术商业化密码》
                —— 中国管理案例共享中心案例库教学案例。探索亿航如何在低空经济领域
                跨越"死亡之谷"，从技术突破走向商业化成功。
              </p>
              <Link
                to="/workbench"
                className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                使用此案例测试 <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
