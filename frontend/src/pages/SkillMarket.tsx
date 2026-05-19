import { Download, Check, Sparkles, BookOpen, BarChart3, Presentation, MessageSquare, Search, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { Skill } from '../types';

const builtinSkills: Skill[] = [
  {
    id: 'case-deconstructor',
    name: '案例解构引擎',
    description: '自动提取案例时间线、关键决策点、人物关系、核心数据，生成结构化摘要',
    icon: 'BookOpen',
    category: '分析',
    installed: true,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'timeline',
        name: '提取时间线',
        description: '提取案例中的关键事件时间线',
        template: '请阅读以下案例，按时间顺序提取所有关键事件，形成结构化时间线：\n\n{{caseText}}',
        variables: ['caseText'],
      },
      {
        id: 'summary',
        name: '生成摘要',
        description: '生成200字核心摘要',
        template: '请用200字概括以下案例的核心矛盾和关键决策点：\n\n{{caseText}}',
        variables: ['caseText'],
      },
    ],
  },
  {
    id: 'framework-recommender',
    name: '框架推荐系统',
    description: '基于案例行业特征智能匹配SWOT、波特五力、价值链等分析框架',
    icon: 'BarChart3',
    category: '分析',
    installed: true,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'recommend',
        name: '推荐框架',
        description: '推荐最适合的分析框架',
        template: '基于以下案例摘要，推荐3个最适合的分析框架，并说明理由：\n\n{{caseSummary}}',
        variables: ['caseSummary'],
      },
    ],
  },
  {
    id: 'insight-generator',
    name: '洞察生成器',
    description: '提供多角度分析、跨行业类比、红队质疑、颠覆性假设等深度洞察',
    icon: 'Lightbulb',
    category: '洞察',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'multiview',
        name: '多角度分析',
        description: '提供5-8个不同分析角度',
        template: '针对以下分析结论，提供3个被忽略的关键视角和2个跨行业类比：\n\n{{analysis}}',
        variables: ['analysis'],
      },
    ],
  },
  {
    id: 'ppt-assistant',
    name: 'PPT助手',
    description: '生成PPT结构大纲、数据可视化建议、配色排版方案、演讲者备注',
    icon: 'Presentation',
    category: '呈现',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'outline',
        name: '生成大纲',
        description: '生成15页以内的PPT结构',
        template: '请为以下分析内容设计PPT结构（15页以内，每页一个核心观点）：\n\n{{content}}',
        variables: ['content'],
      },
    ],
  },
  {
    id: 'qa-simulator',
    name: '答辩模拟器',
    description: '模拟评委提问，预测高概率问题，提供回答框架，训练应变能力',
    icon: 'MessageSquare',
    category: '答辩',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [
      {
        id: 'predict',
        name: '预测问题',
        description: '预测评委可能提出的问题',
        template: '基于以下案例分析，预测评委可能提出的10个问题（按概率排序）：\n\n{{analysis}}',
        variables: ['analysis'],
      },
    ],
  },
  {
    id: 'prompt-manager',
    name: 'Prompt管理器',
    description: '管理Prompt模板库，记录迭代过程，生成AI使用说明报告',
    icon: 'Sparkles',
    category: '工具',
    installed: false,
    version: '1.0.0',
    author: 'CaseBuddy',
    prompts: [],
  },
];

const iconMap: Record<string, React.ElementType> = {
  BookOpen,
  BarChart3,
  Lightbulb,
  Presentation,
  MessageSquare,
  Sparkles,
  Search,
};

const categoryColors: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  '分析': { bg: 'bg-primary-50', text: 'text-primary-600', border: 'border-primary-200', dot: 'bg-primary-500' },
  '洞察': { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', dot: 'bg-amber-500' },
  '呈现': { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  '答辩': { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-200', dot: 'bg-rose-500' },
  '工具': { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200', dot: 'bg-violet-500' },
};

export default function SkillMarket() {
  const [installedSkills, setInstalledSkills] = useLocalStorage<string[]>('casebuddy-skills', ['case-deconstructor', 'framework-recommender']);
  const [animatingId, setAnimatingId] = useState<string | null>(null);

  const toggleSkill = (skillId: string) => {
    setAnimatingId(skillId);
    setTimeout(() => setAnimatingId(null), 400);

    if (installedSkills.includes(skillId)) {
      setInstalledSkills(installedSkills.filter(id => id !== skillId));
    } else {
      setInstalledSkills([...installedSkills, skillId]);
    }
  };

  const categories = [...new Set(builtinSkills.map(s => s.category))];

  return (
    <div className="p-6 md:p-8 max-w-5xl animate-fade-in-scale">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 mb-2">技能市场</h1>
        <p className="text-surface-500">安装和管理 AI 分析技能，扩展 CaseBuddy 的能力</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-surface-200 p-5 card-hover">
          <div className="text-2xl font-bold text-primary-600">{installedSkills.length}</div>
          <div className="text-sm text-surface-500 mt-0.5">已安装技能</div>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-5 card-hover">
          <div className="text-2xl font-bold text-accent-600">{builtinSkills.length}</div>
          <div className="text-sm text-surface-500 mt-0.5">可用技能</div>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 p-5 card-hover">
          <div className="text-2xl font-bold text-emerald-600">
            {builtinSkills.reduce((sum, s) => sum + s.prompts.length, 0)}
          </div>
          <div className="text-sm text-surface-500 mt-0.5">Prompt 模板</div>
        </div>
      </div>

      {/* Skills by Category */}
      {categories.map(category => {
        const skills = builtinSkills.filter(s => s.category === category);
        const colors = categoryColors[category] || categoryColors['分析'];
        return (
          <div key={category} className="mb-8">
            <h2 className="text-lg font-semibold text-surface-800 mb-4 flex items-center gap-2">
              <span className={`w-1.5 h-5 ${colors.dot} rounded-full`} />
              {category}
              <span className="text-xs font-normal text-surface-400 ml-1">({skills.length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {skills.map(skill => {
                const Icon = iconMap[skill.icon] || Sparkles;
                const isInstalled = installedSkills.includes(skill.id);
                const isAnimating = animatingId === skill.id;
                return (
                  <div
                    key={skill.id}
                    className={`bg-white rounded-xl border p-5 transition-all duration-200 card-hover
                      ${isInstalled ? `${colors.border} shadow-sm` : 'border-surface-200'}
                      ${isAnimating ? 'scale-[1.02]' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors
                          ${isInstalled ? colors.bg : 'bg-surface-100'}`}>
                          <Icon className={`w-5 h-5 ${isInstalled ? colors.text : 'text-surface-400'}`} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-surface-900">{skill.name}</h3>
                          <span className="text-xs text-surface-400">v{skill.version} · {skill.author}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleSkill(skill.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 btn-press
                          ${isInstalled
                            ? `${colors.bg} ${colors.text} hover:brightness-95`
                            : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                          }`}
                      >
                        {isInstalled ? (
                          <><Check className={`w-3.5 h-3.5 ${isAnimating ? 'animate-bounce' : ''}`} /> 已安装</>
                        ) : (
                          <><Download className={`w-3.5 h-3.5 ${isAnimating ? 'animate-bounce' : ''}`} /> 安装</>
                        )}
                      </button>
                    </div>
                    <p className="text-sm text-surface-500 leading-relaxed">{skill.description}</p>
                    {skill.prompts.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-surface-100">
                        <div className="text-xs text-surface-400 mb-2">包含 {skill.prompts.length} 个 Prompt 模板</div>
                        <div className="flex flex-wrap gap-1.5">
                          {skill.prompts.map(p => (
                            <span key={p.id} className={`px-2.5 py-1 text-xs rounded-md font-medium
                              ${isInstalled ? `${colors.bg} ${colors.text}` : 'bg-surface-100 text-surface-500'}`}>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
