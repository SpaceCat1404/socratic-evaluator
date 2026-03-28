import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { Send, User, Bot, Play, CheckCircle, RefreshCw, BarChart2, Mic, MicOff } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';

// Types
type AppState = 'setup' | 'viva' | 'report';

interface SetupConfig {
  subject: string;
  studentYear: string;
  branch: string;
  topics: string;
}

interface EvaluationScores {
  conceptual_clarity: number;
  application_ability: number;
  analytical_depth: number;
  communication: number;
  intellectual_curiosity: number;
}

interface AgentResponse {
  agent_message: string;
  internal_thoughts: string;
  current_scores: EvaluationScores;
  is_session_complete: boolean;
}

interface Message {
  role: 'user' | 'model';
  content: string;
  evaluation?: EvaluationScores;
  internal_thoughts?: string;
}

interface FinalReport {
  session_id: string;
  topic: string;
  scores: EvaluationScores & { overall: number };
  strengths: string[];
  gaps: string[];
  recommended_focus: string;
  transcript_summary: string;
}

const RUBRIC_MAX_SCORE = 4;

const clampToRubric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(RUBRIC_MAX_SCORE, value));
};

const normalizeRubricScore = (value: number, assumeTenPointScale: boolean): number => {
  const normalized = assumeTenPointScale ? value * (RUBRIC_MAX_SCORE / 10) : value;
  return clampToRubric(normalized);
};

const normalizeEvaluationScores = (scores: EvaluationScores): EvaluationScores => {
  const rawValues = Object.values(scores).filter((value) => Number.isFinite(value));
  const assumeTenPointScale = rawValues.length > 0 && rawValues.some((value) => value > RUBRIC_MAX_SCORE && value <= 10);

  return {
    conceptual_clarity: normalizeRubricScore(scores.conceptual_clarity, assumeTenPointScale),
    application_ability: normalizeRubricScore(scores.application_ability, assumeTenPointScale),
    analytical_depth: normalizeRubricScore(scores.analytical_depth, assumeTenPointScale),
    communication: normalizeRubricScore(scores.communication, assumeTenPointScale),
    intellectual_curiosity: normalizeRubricScore(scores.intellectual_curiosity, assumeTenPointScale),
  };
};

const calculateOverallScore = (scores: EvaluationScores): number => {
  return (
    scores.conceptual_clarity * 0.25 +
    scores.application_ability * 0.25 +
    scores.analytical_depth * 0.2 +
    scores.communication * 0.15 +
    scores.intellectual_curiosity * 0.15
  );
};

const normalizeFinalReport = (report: FinalReport): FinalReport => {
  const normalizedScores = normalizeEvaluationScores(report.scores);
  return {
    ...report,
    scores: {
      ...normalizedScores,
      // Keep the final score tied to the weighted rubric dimensions.
      overall: clampToRubric(calculateOverallScore(normalizedScores)),
    },
  };
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [appState, setAppState] = useState<AppState>('setup');
  const [config, setConfig] = useState<SetupConfig>({
    subject: 'Design & Analysis of Algorithms',
    studentYear: '2',
    branch: 'CSE/AI-ML',
    topics: 'Dynamic Programming: Knapsack Variations\nGraph Algorithms: Shortest Path Real-world Applications\nGreedy vs DP: When to choose what?',
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentScores, setCurrentScores] = useState<EvaluationScores | null>(null);
  const [finalReport, setFinalReport] = useState<FinalReport | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setInput(prev => prev + (prev.endsWith(' ') || prev === '' ? '' : ' ') + finalTranscript.trim() + ' ');
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    } else {
      setSpeechSupported(false);
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) return;
    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startViva = async () => {
    setAppState('viva');
    setMessages([]);
    setCurrentScores({
      conceptual_clarity: 0,
      application_ability: 0,
      analytical_depth: 0,
      communication: 0,
      intellectual_curiosity: 0,
    });
    
    setIsLoading(true);
    try {
      const initialPrompt = `You are Prof. Socratic, an AI Viva Agent evaluating a student.
Student Profile: Year ${config.studentYear}, Branch ${config.branch}.
Subject: ${config.subject}.
Topics Pool:
${config.topics}

Start the viva session with a "Hook" question based on one of the topics. Do not ask for definitions. Use a real-world scenario, counter-intuitive result, or current event to engage the student.
CRITICAL: Keep your opening question extremely short and conversational (1-2 sentences max). This is a fast-paced 5-minute viva.
Respond strictly in JSON format matching the schema.`;

      const response = await generateAgentResponse([{ role: 'user', content: initialPrompt }]);
      
      if (response) {
        const normalizedScores = normalizeEvaluationScores(response.current_scores);
        setMessages([{ role: 'model', content: response.agent_message, evaluation: normalizedScores, internal_thoughts: response.internal_thoughts }]);
        setCurrentScores(normalizedScores);
      }
    } catch (error) {
      console.error("Failed to start viva:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateAgentResponse = async (history: Message[]): Promise<AgentResponse | null> => {
    try {
      const systemInstruction = `You are "Prof. Socratic", an AI Viva Agent evaluating a student.
Your role is to act as a curious mentor, challenging but encouraging. Use the Socratic method—guide through questioning rather than lecturing.

CRITICAL CONSTRAINTS:
1. Keep your questions VERY SHORT, conversational, and direct (maximum 1-2 sentences).
2. This is a fast-paced 5-minute viva session. Pace the conversation to reach the synthesis/evaluation phase after about 4-5 exchanges.
3. Do not give long explanations. Ask the question and wait for the student.

Follow this Bloom's Taxonomy spiral: Remember -> Understand -> Apply -> Analyze -> Evaluate -> Create.
Maintain an internal knowledge state of the student.
If the student struggles, simplify or find prerequisite gaps.
If they excel, increase complexity or introduce constraints.

Evaluate the student on a 0-4 scale across 5 dimensions:
- Conceptual Clarity (25%)
- Application Ability (25%)
- Analytical Depth (20%)
- Communication (15%)
- Intellectual Curiosity (15%)

You MUST respond with a JSON object containing:
- agent_message: The message to show to the student.
- internal_thoughts: Your reasoning about the student's response and what to ask next.
- current_scores: The updated evaluation scores (0-4).
- is_session_complete: Set to true ONLY if you have asked a synthesis question, a self-assessment question, and provided encouragement, concluding the viva.`;

      const contents = history.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.role === 'model' ? JSON.stringify({ agent_message: msg.content, current_scores: msg.evaluation, internal_thoughts: msg.internal_thoughts }) : msg.content }]
      }));

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          agent_message: { type: Type.STRING },
          internal_thoughts: { type: Type.STRING },
          current_scores: {
            type: Type.OBJECT,
            properties: {
              conceptual_clarity: { type: Type.NUMBER },
              application_ability: { type: Type.NUMBER },
              analytical_depth: { type: Type.NUMBER },
              communication: { type: Type.NUMBER },
              intellectual_curiosity: { type: Type.NUMBER },
            },
            required: ['conceptual_clarity', 'application_ability', 'analytical_depth', 'communication', 'intellectual_curiosity']
          },
          is_session_complete: { type: Type.BOOLEAN }
        },
        required: ['agent_message', 'internal_thoughts', 'current_scores', 'is_session_complete']
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: contents as any,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.7,
        }
      });

      const text = response.text;
      if (text) {
        return JSON.parse(text) as AgentResponse;
      }
      return null;
    } catch (error) {
      console.error("Error generating response:", error);
      return null;
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const newMessages: Message[] = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await generateAgentResponse(newMessages);
      if (response) {
        const normalizedScores = normalizeEvaluationScores(response.current_scores);
        setMessages([...newMessages, { 
          role: 'model', 
          content: response.agent_message, 
          evaluation: normalizedScores,
          internal_thoughts: response.internal_thoughts
        }]);
        setCurrentScores(normalizedScores);

        if (response.is_session_complete) {
          generateFinalReport([...newMessages, { 
            role: 'model', 
            content: response.agent_message, 
            evaluation: normalizedScores,
            internal_thoughts: response.internal_thoughts
          }]);
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateFinalReport = async (fullHistory: Message[]) => {
    setIsLoading(true);
    try {
      const transcript = fullHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
      
      const prompt = `Analyze the following viva transcript and generate a final evaluation report.
Subject: ${config.subject}
Topics: ${config.topics}

    CRITICAL SCORING RULES:
    - Use only the 0-4 rubric scale for every score field.
    - scores.conceptual_clarity, scores.application_ability, scores.analytical_depth, scores.communication, and scores.intellectual_curiosity MUST each be between 0 and 4.
    - scores.overall MUST be a weighted 0-4 score using weights: 25%, 25%, 20%, 15%, 15%.

Transcript:
${transcript}

Generate a JSON report matching the specified schema.`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          session_id: { type: Type.STRING },
          topic: { type: Type.STRING },
          scores: {
            type: Type.OBJECT,
            properties: {
              conceptual_clarity: { type: Type.NUMBER },
              application_ability: { type: Type.NUMBER },
              analytical_depth: { type: Type.NUMBER },
              communication: { type: Type.NUMBER },
              intellectual_curiosity: { type: Type.NUMBER },
              overall: { type: Type.NUMBER }
            },
            required: ['conceptual_clarity', 'application_ability', 'analytical_depth', 'communication', 'intellectual_curiosity', 'overall']
          },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommended_focus: { type: Type.STRING },
          transcript_summary: { type: Type.STRING }
        },
        required: ['session_id', 'topic', 'scores', 'strengths', 'gaps', 'recommended_focus', 'transcript_summary']
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.2,
        }
      });

      if (response.text) {
        const report = JSON.parse(response.text) as FinalReport;
        setFinalReport(normalizeFinalReport(report));
        setAppState('report');
      }
    } catch (error) {
      console.error("Failed to generate report:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const renderSetup = () => (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto mt-12"
    >
      <Card className="border-zinc-200 shadow-lg">
        <CardHeader className="bg-zinc-50 border-b border-zinc-100 rounded-t-xl">
          <CardTitle className="text-2xl flex items-center gap-2">
            <Bot className="w-6 h-6 text-indigo-600" />
            Socratic Evaluator Setup
          </CardTitle>
          <CardDescription>Configure the AI Viva Agent for the upcoming session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">Subject</label>
            <Input 
              value={config.subject} 
              onChange={e => setConfig({...config, subject: e.target.value})}
              placeholder="e.g., Design & Analysis of Algorithms"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">Student Year</label>
              <Input 
                value={config.studentYear} 
                onChange={e => setConfig({...config, studentYear: e.target.value})}
                placeholder="e.g., 2"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">Branch</label>
              <Input 
                value={config.branch} 
                onChange={e => setConfig({...config, branch: e.target.value})}
                placeholder="e.g., CSE/AI-ML"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-700">Topics Pool (one per line)</label>
            <Textarea 
              value={config.topics} 
              onChange={e => setConfig({...config, topics: e.target.value})}
              className="min-h-[120px]"
              placeholder="Enter topics..."
            />
          </div>
        </CardContent>
        <CardFooter className="bg-zinc-50 border-t border-zinc-100 rounded-b-xl flex justify-end">
          <Button onClick={startViva} disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {isLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Start Viva Session
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );

  const renderViva = () => (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full border-x border-zinc-200 bg-white shadow-sm">
        <div className="h-16 border-b border-zinc-200 flex items-center justify-between px-6 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <Bot className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-semibold text-zinc-900">Prof. Socratic</h2>
              <p className="text-xs text-zinc-500">{config.subject}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => generateFinalReport(messages)} disabled={isLoading}>
            End Session & Evaluate
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <AnimatePresence>
            {messages.map((msg, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-zinc-900 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                    {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className={`p-4 rounded-2xl ${msg.role === 'user' ? 'bg-zinc-900 text-white rounded-tr-sm' : 'bg-zinc-100 text-zinc-900 rounded-tl-sm'}`}>
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                    {msg.role === 'model' && msg.internal_thoughts && (
                      <div className="px-2 py-1 text-xs text-zinc-500 bg-zinc-50 rounded-md border border-zinc-100 mt-1">
                        <span className="font-semibold text-indigo-600/70">Internal Thought: </span>
                        {msg.internal_thoughts}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="max-w-[80%] flex gap-3 flex-row">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="p-4 rounded-2xl bg-zinc-100 text-zinc-900 rounded-tl-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-zinc-200 bg-white">
          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <Textarea 
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={isRecording ? "Listening..." : "Type your answer... (Shift+Enter for new line)"}
                className={`min-h-[60px] resize-none pb-10 ${isRecording ? 'border-red-300 ring-1 ring-red-300' : ''}`}
                disabled={isLoading}
              />
              {speechSupported && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`absolute bottom-2 left-2 rounded-full h-8 w-8 ${isRecording ? 'text-red-500 hover:text-red-600 hover:bg-red-50' : 'text-zinc-400 hover:text-zinc-600'}`}
                  onClick={toggleRecording}
                  disabled={isLoading}
                  title={isRecording ? "Stop Recording" : "Start Voice Input"}
                >
                  {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
              )}
            </div>
            <Button 
              className="h-[60px] px-6 bg-indigo-600 hover:bg-indigo-700 text-white shrink-0" 
              onClick={handleSendMessage}
              disabled={isLoading || !input.trim()}
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Side Panel: Real-time Evaluation */}
      <div className="w-80 border-l border-zinc-200 bg-white p-6 overflow-y-auto hidden lg:block">
        <h3 className="font-semibold text-zinc-900 mb-6 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-indigo-600" />
          Real-time Evaluation
        </h3>
        
        {currentScores ? (
          <div className="space-y-6">
            {Object.entries(currentScores).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-600 capitalize">{key.replace('_', ' ')}</span>
                  <span className="font-medium text-zinc-900">{value.toFixed(1)} / 4.0</span>
                </div>
                <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-indigo-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(value / 4) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500 text-center py-10">
            Awaiting initial evaluation...
          </div>
        )}
      </div>
    </div>
  );

  const renderReport = () => {
    if (!finalReport) return null;

    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-4xl mx-auto mt-12 mb-12"
      >
        <Card className="border-zinc-200 shadow-xl overflow-hidden">
          <div className="bg-indigo-600 p-8 text-white">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-3xl font-bold mb-2">Viva Evaluation Report</h2>
                <p className="text-indigo-100 opacity-90">Session ID: {finalReport.session_id}</p>
              </div>
              <div className="text-right">
                <div className="text-5xl font-bold mb-1">{finalReport.scores.overall.toFixed(1)}</div>
                <div className="text-indigo-200 text-sm uppercase tracking-wider font-semibold">Overall Score</div>
              </div>
            </div>
          </div>
          
          <CardContent className="p-8 space-y-8">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 mb-4 border-b pb-2">Topic Covered</h3>
                <p className="text-zinc-700">{finalReport.topic}</p>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 mb-4 border-b pb-2">Recommended Focus</h3>
                <p className="text-zinc-700">{finalReport.recommended_focus}</p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-4 border-b pb-2">Detailed Scores</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(finalReport.scores).filter(([k]) => k !== 'overall').map(([key, value]) => (
                  <div key={key} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-600 capitalize font-medium">{key.replace('_', ' ')}</span>
                      <span className="font-bold text-zinc-900">{value.toFixed(1)} / 4.0</span>
                    </div>
                    <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${(value / 4) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-100">
                <h3 className="text-lg font-semibold text-emerald-900 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  Key Strengths
                </h3>
                <ul className="space-y-3">
                  {finalReport.strengths.map((strength, i) => (
                    <li key={i} className="flex gap-2 text-emerald-800 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-amber-50 p-6 rounded-xl border border-amber-100">
                <h3 className="text-lg font-semibold text-amber-900 mb-4 flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-amber-600" />
                  Areas for Improvement
                </h3>
                <ul className="space-y-3">
                  {finalReport.gaps.map((gap, i) => (
                    <li key={i} className="flex gap-2 text-amber-800 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      {gap}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-4 border-b pb-2">Transcript Summary</h3>
              <p className="text-zinc-700 leading-relaxed bg-zinc-50 p-6 rounded-xl border border-zinc-100">
                {finalReport.transcript_summary}
              </p>
            </div>
          </CardContent>
          <CardFooter className="bg-zinc-50 border-t border-zinc-100 p-6 flex justify-between">
            <Button variant="outline" onClick={() => setAppState('setup')}>
              Start New Session
            </Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => window.print()}>
              Export PDF
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      {appState === 'setup' && renderSetup()}
      {appState === 'viva' && renderViva()}
      {appState === 'report' && renderReport()}
    </div>
  );
}
