import React, { useState, useEffect, useRef } from "react";
import { auth, db, provider, signInWithPopup, signOut } from "./firebase";
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from "firebase/firestore";

// (1) Gemini API 엔드포인트 & 키 (환경변수에서 가져오기)
const GEMINI_API_URL = process.env.REACT_APP_GEMINI_API_URL;
const API_KEY = process.env.REACT_APP_GEMINI_API_KEY;

function buildSystemPrompt(character) {
  return `
[캐릭터 정보]
이름: ${character.name || "이름 미설정"}
성별: ${character.gender === "male" ? "남성" : character.gender === "female" ? "여성" : "미설정"}
말투: ${character.manner || "설정 없음"}
성격: ${character.personality || "설정 없음"}
배경: ${character.background || "없음"}

지침: 
${character.prompt || "(특별 지침 없음)"}

너는 반드시 위 정보에 따라 캐릭터처럼 행동하고, 절대 캐릭터의 설정을 잊지 마라.
플레이어의 역할극, 연애, 판타지 상황극에도 적극적으로 어울려야 한다.
`;
}

function App() {
  // 0. 로그인 상태 관리
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(u => setUser(u));
    return unsub;
  }, []);

  // 1. 캐릭터 목록/선택 State (Firestore 기반)
  const [characters, setCharacters] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [newCharacter, setNewCharacter] = useState({ name: "", personality: "", background: "", prompt: "" });

  // *** 캐릭터 수정 상태 ***
  const [editingId, setEditingId] = useState(null);
  const [editCharacter, setEditCharacter] = useState({ name: "", personality: "", background: "", prompt: "" });

  // 2. 대화 내역 State (Firestore 기반)
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // *** 대화창 자동 스크롤 ref ***
  const bottomRef = useRef(null);

  // 3. 캐릭터 불러오기 (로그인 후)
  useEffect(() => {
    if (!user) {
      setCharacters([]);
      return;
    }
    async function fetchCharacters() {
      const docs = await getDocs(collection(db, "users", user.uid, "characters"));
      const arr = [];
      docs.forEach(docSnap => arr.push({ ...docSnap.data(), id: docSnap.id }));
      setCharacters(arr);
    }
    fetchCharacters();
  }, [user]);

  // 4. 캐릭터 저장
  async function handleSaveCharacter() {
    if (!user || !newCharacter.name.trim()) return;
    const charId = Date.now().toString();
    await setDoc(doc(db, "users", user.uid, "characters", charId), newCharacter);
    setCharacters(prev => [...prev, { ...newCharacter, id: charId }]);
    setNewCharacter({ name: "", personality: "", background: "", prompt: "" });
    setSelectedId(charId); // 새 캐릭터 선택!
  }

  // *** 캐릭터 수정 저장 ***
  async function handleEditCharacterSave() {
    if (!user || !editingId || !editCharacter.name.trim()) return;
    await setDoc(doc(db, "users", user.uid, "characters", editingId), editCharacter);
    setCharacters(prev => prev.map(c => c.id === editingId ? { ...editCharacter, id: editingId } : c));
    // 대화 내역 초기화
    await setDoc(doc(db, "users", user.uid, "chats", editingId), { messages: [] });
    setEditingId(null);
    if (selectedId === editingId) setMessages([]);
  }

  // 5. 캐릭터 삭제
  async function handleDeleteCharacter(id) {
    if (!window.confirm("정말 삭제할까요?") || !user) return;
    await deleteDoc(doc(db, "users", user.uid, "characters", id));
    await deleteDoc(doc(db, "users", user.uid, "chats", id)); // 대화 내역도 같이 삭제
    setCharacters(prev => prev.filter(c => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editingId === id) setEditingId(null);
  }

  // 6. 캐릭터 선택시 대화 불러오기
  useEffect(() => {
    if (!user || !selectedId) {
      setMessages([]);
      return;
    }
    setMessages([]); // 캐릭터 변경 시 항상 초기화!
    async function fetchMessages() {
      const docSnap = await getDoc(doc(db, "users", user.uid, "chats", selectedId));
      if (docSnap.exists()) setMessages(docSnap.data().messages || []);
      else setMessages([]);
    }
    fetchMessages();
  }, [user, selectedId]);

  // *** 대화창 자동 스크롤 ***
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // 7. 대화 저장
  const prevSelectedId = useRef(null);
  useEffect(() => {
    // selectedId가 바뀐 순간에는 저장하지 않도록 막음!
    if (!user || !selectedId || messages.length === 0) return;
    // selectedId가 이전과 다를 경우(=캐릭터 전환 직후)에는 저장 패스!
    if (prevSelectedId.current !== selectedId) {
      prevSelectedId.current = selectedId;
      return;
    }
    async function saveMessages() {
      try {
        await setDoc(doc(db, "users", user.uid, "chats", selectedId), { messages });
      } catch (error) {
        console.error("대화 저장 실패:", error);
      }
    }
    saveMessages();
  }, [messages, user, selectedId]);

  // 8. Gemini 챗봇 요청
  async function sendMessage(e) {
    e.preventDefault();
    const selectedCharacter = characters.find(c => c.id === selectedId);
    if (!input.trim() || !selectedCharacter) return;
  
    let systemPromptMsg = { role: "user", parts: [{ text: buildSystemPrompt(selectedCharacter) }] };
  
    let baseMessages = messages;
    let sendMessages;
  
    if (messages.length === 0) {
      // 실제 저장할 messages에는 "user의 첫 메시지"만 저장
      baseMessages = [];
      sendMessages = [systemPromptMsg, { role: "user", parts: [{ text: input }] }];
    } else {
      sendMessages = [
        systemPromptMsg,
        ...messages, // 실제 대화 내역
        { role: "user", parts: [{ text: input }] },
      ];
    }
  
    // 화면에는 시스템 프롬프트는 안 보여주고 실제 대화만!
    const nextMessages = [...baseMessages, { role: "user", parts: [{ text: input }] }];
    setMessages(nextMessages);
    setLoading(true);
  
    try {
      const res = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: sendMessages }),
      });
      const data = await res.json();
      const reply =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        data.candidates?.[0]?.content?.text ||
        "AI 응답 오류!";
      setMessages([...nextMessages, { role: "model", parts: [{ text: reply }] }]);
    } catch (error) {
      setMessages([...nextMessages, { role: "model", parts: [{ text: "죄송합니다. 오류가 발생했습니다." }] }]);
    } finally {
      setInput("");
      setLoading(false);
    }
  }

  // 9. 구글 로그인/로그아웃
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      alert(e.message);
    }
  };
  const handleLogout = async () => {
    await signOut(auth);
  };

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", padding: 20, border: "1px solid #ddd", borderRadius: 10 }}>
      <h2>MyChat (AI 채팅 시뮬레이션 게임)</h2>
      {!user ? (
        <button onClick={handleLogin} style={{ padding: 10, fontSize: 16, marginTop: 60 }}>구글 로그인</button>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <span>👤 {user.displayName} ({user.email})</span>
            <button onClick={handleLogout} style={{ marginLeft: 16 }}>로그아웃</button>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {/* 캐릭터 리스트/관리 */}
            <div style={{ flex: 1 }}>
              <h3>내 캐릭터</h3>
              <ul>
                {characters.map(c => (
                  <li key={c.id} style={{ marginBottom: 4 }}>
                    <button
                      style={{ marginRight: 6, fontWeight: selectedId === c.id ? "bold" : "normal" }}
                      onClick={() => setSelectedId(c.id)}
                    >
                      {c.name}
                    </button>
                    <button onClick={() => handleDeleteCharacter(c.id)} style={{ color: "red", fontSize: 11 }}>삭제</button>
                    {/* 캐릭터 수정 버튼 */}
                    <button
                      onClick={() => {
                        setEditingId(c.id);
                        setEditCharacter({ ...c });
                      }}
                      style={{ color: "blue", fontSize: 11, marginLeft: 4 }}
                    >
                      수정
                    </button>
                  </li>
                ))}
              </ul>
              <div style={{ border: "1px solid #aaa", padding: 8, borderRadius: 6 }}>
                <h4>캐릭터 생성</h4>
                <input
                  placeholder="이름"
                  value={newCharacter.name}
                  onChange={e => setNewCharacter({ ...newCharacter, name: e.target.value })}
                  style={{ width: "48%" }}
                />
                <label style={{ marginLeft: 8 }}>
                  <input
                    type="radio"
                    name="new-gender"
                    checked={newCharacter.gender === "male"}
                    onChange={() => setNewCharacter({ ...newCharacter, gender: "male" })}
                  /> 남
                </label>
                <label style={{ marginLeft: 8 }}>
                  <input
                    type="radio"
                    name="new-gender"
                    checked={newCharacter.gender === "female"}
                    onChange={() => setNewCharacter({ ...newCharacter, gender: "female" })}
                  /> 여
                </label>
                <br />
                <input
                  placeholder="말투"
                  value={newCharacter.manner || ""}
                  onChange={e => setNewCharacter({ ...newCharacter, manner: e.target.value })}
                  style={{ width: "95%", marginBottom: 4 }}
                /><br />
                <input
                  placeholder="성격"
                  value={newCharacter.personality || ""}
                  onChange={e => setNewCharacter({ ...newCharacter, personality: e.target.value })}
                  style={{ width: "95%", marginBottom: 4 }}
                /><br />
                <input
                  placeholder="배경/소개"
                  value={newCharacter.background || ""}
                  onChange={e => setNewCharacter({ ...newCharacter, background: e.target.value })}
                  style={{ width: "95%", marginBottom: 4 }}
                /><br />
                <textarea
                  placeholder="추가 프롬프트(지침)"
                  rows={2}
                  value={newCharacter.prompt}
                  onChange={e => setNewCharacter({ ...newCharacter, prompt: e.target.value })}
                  style={{ width: "95%" }}
                /><br />
                <button onClick={handleSaveCharacter} style={{ marginTop: 6 }}>저장</button>
              </div>
              {/* 캐릭터 수정 폼 */}
              {editingId && (
                <div style={{ border: "1px solid #2a6", padding: 8, borderRadius: 6, marginTop: 12, background: "#f5fff5" }}>
                  <h4>캐릭터 수정</h4>
                  <input
                    placeholder="이름"
                    value={editCharacter.name}
                    onChange={e => setEditCharacter({ ...editCharacter, name: e.target.value })}
                    style={{ width: "48%" }}
                  />
                  <label style={{ marginLeft: 8 }}>
                    <input
                      type="radio"
                      name="new-gender"
                      checked={editCharacter.gender === "male"}
                      onChange={() => setEditCharacter({ ...editCharacter, gender: "male" })}
                    /> 남
                  </label>
                  <label style={{ marginLeft: 8 }}>
                    <input
                      type="radio"
                      name="new-gender"
                      checked={editCharacter.gender === "female"}
                      onChange={() => setEditCharacter({ ...editCharacter, gender: "female" })}
                    /> 여
                  </label>
                  <br />
                  <input
                    placeholder="말투"
                    value={editCharacter.manner || ""}
                    onChange={e => setEditCharacter({ ...editCharacter, manner: e.target.value })}
                    style={{ width: "95%", marginBottom: 4 }}
                  /><br />
                  <input
                    placeholder="성격"
                    value={editCharacter.personality || ""}
                    onChange={e => setEditCharacter({ ...editCharacter, personality: e.target.value })}
                    style={{ width: "95%", marginBottom: 4 }}
                  /><br />
                  <input
                    placeholder="배경/소개"
                    value={editCharacter.background}
                    onChange={e => setEditCharacter({ ...editCharacter, background: e.target.value })}
                    style={{ width: "95%", marginBottom: 4 }}
                  /><br />
                  <textarea
                    placeholder="추가 프롬프트(지침)"
                    rows={2}
                    value={editCharacter.prompt}
                    onChange={e => setEditCharacter({ ...editCharacter, prompt: e.target.value })}
                    style={{ width: "95%" }}
                  /><br />
                  <button onClick={handleEditCharacterSave} style={{ marginTop: 6 }}>저장</button>
                  <button onClick={() => setEditingId(null)} style={{ marginLeft: 8 }}>취소</button>
                </div>
              )}
            </div>
            {/* 대화 영역 */}
            <div style={{ flex: 2 }}>
              <h3>채팅</h3>
              <button
                onClick={async () => {
                  if (!window.confirm("정말 대화 내역을 초기화할까요?")) return;
                  await setDoc(doc(db, "users", user.uid, "chats", selectedId), { messages: [] });
                  setMessages([]);
                }}
                style={{ marginBottom: 8, fontSize: 13, color: "#b35", border: "1px solid #b35", background: "#fff4f4", borderRadius: 5, padding: "2px 10px" }}
              >
                대화 초기화
              </button>
              {selectedId ? (
                <>
                  <div style={{ marginBottom: 12, fontSize: 14, color: "#595959" }}>
                    <b style={{ fontSize: 16, fontWeight: "bold" }}>{characters.find(c => c.id === selectedId)?.name}</b> <br />
                    {characters.find(c => c.id === selectedId)?.manner}<br />
                    {characters.find(c => c.id === selectedId)?.personality}<br />
                    {characters.find(c => c.id === selectedId)?.background}<br />
                    {characters.find(c => c.id === selectedId)?.prompt}
                  </div>
                  <div style={{ minHeight: 400, maxHeight: 800, marginBottom: 20, background: "#f9f9f9", padding: 10, borderRadius: 6, overflowY: "auto" }}>
                    {messages.map((msg, i) => (
                      <div key={i} style={{ textAlign: msg.role === "user" ? "right" : "left", margin: "10px 0" }}>
                        <b>
                          {msg.role === "user"
                            ? "나:"
                            : (characters.find(c => c.id === selectedId)?.name || "AI") + ":"}
                        </b>{" "}
                        {msg.parts?.[0]?.text || ""}
                      </div>
                    ))}
                    <div ref={bottomRef} /> {/* 자동 스크롤용 */}
                    {loading && <div>응답 중...</div>}
                  </div>
                  <form onSubmit={sendMessage}>
                    <textarea
                      rows={3}
                      style={{ width: "70%", padding: 8, resize: "vertical" }}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      placeholder="메시지를 입력하세요"
                      disabled={loading}
                    />
                    <button type="submit" style={{ padding: "8px 16px", marginLeft: 8 }} disabled={loading}>보내기</button>
                  </form>
                </>
              ) : (
                <div style={{ color: "#aaa", fontSize: 15, marginTop: 30 }}>대화할 캐릭터를 선택하세요.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
