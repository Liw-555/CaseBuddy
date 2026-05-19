import { useState } from 'react';
import { Plus, Trash2, Check, Server, Key, Globe, Cpu } from 'lucide-react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { ModelConfig } from '../types';

const defaultModels: ModelConfig[] = [
  {
    id: 'ecnu-plus',
    name: 'ECNU Plus',
    baseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
    apiKey: '',
    modelId: 'ecnu-plus',
    isDefault: true,
  },
  {
    id: 'ecnu-max',
    name: 'ECNU Max',
    baseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
    apiKey: '',
    modelId: 'ecnu-max',
    isDefault: false,
  },
];

export default function ModelConfig() {
  const [models, setModels] = useLocalStorage<ModelConfig[]>('casebuddy-models', defaultModels);
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const handleSave = () => {
    if (!editing) return;
    if (editing.id === 'new') {
      const newModel = { ...editing, id: Date.now().toString() };
      setModels([...models, newModel]);
    } else {
      setModels(models.map(m => m.id === editing.id ? editing : m));
    }
    setEditing(null);
    setIsAdding(false);
  };

  const handleDelete = (id: string) => {
    setModels(models.filter(m => m.id !== id));
  };

  const handleSetDefault = (id: string) => {
    setModels(models.map(m => ({ ...m, isDefault: m.id === id })));
  };

  const startAdd = () => {
    setIsAdding(true);
    setEditing({
      id: 'new',
      name: '',
      baseUrl: '',
      apiKey: '',
      modelId: '',
      isDefault: false,
    });
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-surface-900 mb-2">模型配置</h1>
        <p className="text-surface-500">配置 LLM API，支持 OpenAI 兼容格式</p>
        <p className="text-xs text-amber-600 mt-1">
          默认已配置 ECNU API（Plus / Max），请在编辑中填入你自己的 API Key
        </p>
      </div>

      {/* Model List */}
      <div className="space-y-4 mb-8">
        {models.map((model) => (
          <div 
            key={model.id} 
            className={`bg-white rounded-xl border p-5 transition-all
              ${model.isDefault ? 'border-primary-300 shadow-sm' : 'border-surface-200'}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Server className="w-5 h-5 text-primary-500" />
                  <h3 className="font-semibold text-surface-900">{model.name}</h3>
                  {model.isDefault && (
                    <span className="px-2 py-0.5 bg-primary-50 text-primary-600 text-xs rounded-full border border-primary-200">
                      默认
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-surface-500">
                    <Globe className="w-4 h-4" />
                    <span className="truncate">{model.baseUrl}</span>
                  </div>
                  <div className="flex items-center gap-2 text-surface-500">
                    <Cpu className="w-4 h-4" />
                    <span>{model.modelId}</span>
                  </div>
                  <div className="flex items-center gap-2 text-surface-500">
                    <Key className="w-4 h-4" />
                    <span>{model.apiKey ? '●●●●●●●●' : '未设置'}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {!model.isDefault && (
                  <button
                    onClick={() => handleSetDefault(model.id)}
                    className="p-2 text-surface-400 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-colors"
                    title="设为默认"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setEditing(model)}
                  className="p-2 text-surface-400 hover:text-accent-500 hover:bg-accent-50 rounded-lg transition-colors"
                >
                  编辑
                </button>
                {models.length > 1 && (
                  <button
                    onClick={() => handleDelete(model.id)}
                    className="p-2 text-surface-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Button */}
      {!isAdding && (
        <button
          onClick={startAdd}
          className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-surface-300 
            text-surface-500 hover:border-primary-400 hover:text-primary-500 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加模型
        </button>
      )}

      {/* Edit Form */}
      {(isAdding || editing) && (
        <div className="bg-white rounded-xl border border-surface-200 p-6 mt-4">
          <h3 className="font-semibold text-surface-900 mb-4">
            {isAdding ? '添加模型' : '编辑模型'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">名称</label>
              <input
                type="text"
                value={editing?.name || ''}
                onChange={e => setEditing(prev => prev ? { ...prev, name: e.target.value } : null)}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="例如：Claude"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Base URL</label>
              <input
                type="text"
                value={editing?.baseUrl || ''}
                onChange={e => setEditing(prev => prev ? { ...prev, baseUrl: e.target.value } : null)}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="https://api.example.com/v1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">API Key</label>
              <input
                type="password"
                value={editing?.apiKey || ''}
                onChange={e => setEditing(prev => prev ? { ...prev, apiKey: e.target.value } : null)}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">模型 ID</label>
              <input
                type="text"
                value={editing?.modelId || ''}
                onChange={e => setEditing(prev => prev ? { ...prev, modelId: e.target.value } : null)}
                className="w-full px-3 py-2 border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                placeholder="例如：claude-sonnet-4-6"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors"
            >
              保存
            </button>
            <button
              onClick={() => { setEditing(null); setIsAdding(false); }}
              className="px-4 py-2 border border-surface-300 text-surface-600 hover:bg-surface-50 rounded-lg transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
