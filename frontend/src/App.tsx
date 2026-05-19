import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './pages/Layout';
import Home from './pages/Home';
import WorkBench from './pages/WorkBench';
import ModelConfig from './pages/ModelConfig';
import SkillMarket from './pages/SkillMarket';
import PPTAssistant from './pages/PPTAssistant';
import { SessionProvider } from './contexts/SessionContext';
import './App.css';

function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="workbench" element={<WorkBench />} />
            <Route path="ppt-assistant" element={<PPTAssistant />} />
            <Route path="skills" element={<SkillMarket />} />
            <Route path="models" element={<ModelConfig />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}

export default App;
