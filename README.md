# MyChat - AI 채팅 시뮬레이션 게임

AI 캐릭터와 대화할 수 있는 React 기반 채팅 애플리케이션입니다.

![image](https://github.com/user-attachments/assets/768471b9-5bc9-480b-a40d-4cefe11a1f85)


## 기능

- 구글 로그인/로그아웃
- 캐릭터 생성, 수정, 삭제
- AI 캐릭터와의 실시간 대화
- 대화 내역 저장 및 불러오기
- Firebase Firestore를 통한 데이터 저장

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경변수 설정
프로젝트 루트에 `.env` 파일을 생성하고 다음 내용을 추가하세요:

```env
# Firebase 설정
REACT_APP_FIREBASE_API_KEY=your_firebase_api_key_here
REACT_APP_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id

# Gemini API 설정
REACT_APP_GEMINI_API_KEY=your_gemini_api_key_here
REACT_APP_GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
```

### 3. Firebase 설정
1. [Firebase Console](https://console.firebase.google.com/)에서 새 프로젝트 생성
2. Authentication에서 Google 로그인 활성화
3. Firestore Database 생성
4. 프로젝트 설정에서 웹 앱 추가하여 설정값 복사

### 4. Gemini API 설정
1. [Google AI Studio](https://makersuite.google.com/app/apikey)에서 API 키 생성
2. `.env` 파일에 API 키 추가

### 5. 애플리케이션 실행
```bash
npm start
```

## 주의사항

- `.env` 파일은 절대 GitHub에 업로드하지 마세요
- API 키는 안전하게 보관하고 공개하지 마세요
- 프로덕션 배포 시 환경변수를 적절히 설정하세요

## 기술 스택

- React
- Firebase (Authentication, Firestore)
- Google Gemini AI API
- CSS (인라인 스타일)
