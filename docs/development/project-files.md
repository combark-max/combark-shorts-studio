# 프로젝트 파일과 복구 데이터

이 문서는 Combark Shorts Studio의 현재 Phase 2 구현을 기준으로 프로젝트 저장, 복구, 최근 프로젝트 동작을 설명한다.

## `.cssproj` 프로젝트 파일

`.cssproj`는 사용자가 저장하고 다시 여는 Combark Shorts Studio 프로젝트 파일이다. 현재 형식은 JSON 기반의 `ProjectDocumentV1`이며 `schemaVersion`은 `1`이다. 문서에는 프로젝트 ID와 이름, 생성·수정 시각, 세로 영상 설정(`1080 × 1920`, `30fps`)이 들어간다.

프로젝트 경로와 UI 상태인 `dirty`, `lastSavedAt`은 `.cssproj` 문서 자체에 저장되지 않는다. 파일을 읽거나 쓰기 전에 main process에서 프로젝트 구조를 검증하며, 저장할 때는 임시 파일을 쓴 뒤 대상 파일로 교체한다.

## 저장과 열기

- **새 프로젝트**는 고유한 `projectId`를 갖지만 아직 파일 경로는 없다. 초기 상태는 `dirty=false`, `lastSavedAt=null`이다.
- **열기**는 Windows 파일 선택 대화상자에서 `.cssproj`를 고른 뒤 main process가 파일을 읽고 검증한다. 성공하면 선택한 경로가 현재 `filePath`가 되고 `dirty=false`가 된다.
- **Save**는 현재 `filePath`가 있으면 그 경로에 저장한다. 경로가 없는 새 프로젝트나 복구 프로젝트에서는 Save As 흐름을 사용한다.
- **Save As**는 저장 대화상자에서 새 경로를 선택한다. 확장자를 생략하면 `.cssproj`가 붙는다. 성공하면 현재 `filePath`가 새 경로로 바뀐다.
- 저장 대화상자를 취소하거나 파일 쓰기가 실패하면 현재 프로젝트 상태와 recovery 파일을 정리하지 않는다.
- 정상 저장이 완료되면 `dirty=false`가 되고 `lastSavedAt`이 갱신된다. 해당 프로젝트의 recovery 삭제 실패는 정상 프로젝트 저장 결과를 되돌리지 않는다.

`filePath`는 현재 프로젝트가 연결된 실제 파일 위치이며 renderer 상태로 관리된다. `dirty=true`는 메모리의 프로젝트 내용에 저장되지 않은 변경이 있음을 뜻한다. `lastSavedAt`은 현재 앱 실행 중 정상 저장이 성공한 시각이며, 프로젝트를 새로 만들거나 파일을 열거나 recovery를 복구하면 `null`이다.

## Recovery autosave

Recovery는 일반 `.cssproj` 저장을 대신하지 않는 비상 복구용 사본이다.

- 앱은 프로젝트가 `dirty=true`일 때만 정확히 30초 간격으로 recovery 저장을 시도한다.
- recovery 저장은 `filePath`, `dirty`, `lastSavedAt`, 프로젝트의 `updatedAt`을 변경하지 않는다.
- 이전 recovery 쓰기가 끝나지 않았으면 다음 쓰기를 겹쳐 실행하지 않는다.
- 저장 위치는 Electron `userData` 아래의 `recovery` 폴더이며 파일명은 `<projectId>.recovery.json`이다.
- recovery에는 검증된 `ProjectDocumentV1` 내용이 저장되고 원래 `.cssproj` 경로는 포함되지 않는다.
- recovery 쓰기 실패는 editor 사용을 중단시키지 않는다.
- 정상 Save 또는 Save As가 성공하면 진행 중인 recovery 쓰기를 기다린 뒤 해당 `projectId`의 recovery 파일을 삭제한다.

## 앱 시작 시 복구

앱은 editor와 최근 프로젝트 목록을 보여주기 전에 recovery 후보를 확인한다. 유효한 후보가 있으면 수정 시각이 최신인 순서로 복구 화면에 표시한다.

- **복구**를 선택하면 recovery의 프로젝트가 현재 프로젝트가 된다. 이 상태는 `filePath=null`, `dirty=true`, `lastSavedAt=null`이며 recovery 파일은 즉시 삭제하지 않는다. 따라서 첫 Save는 Save As 대화상자를 열고, 정상 저장이 끝난 뒤 recovery가 정리된다.
- **버리기**를 선택하면 해당 프로젝트 ID의 recovery 파일만 삭제한다. 삭제가 실패하면 후보를 유지하고 오류를 표시한다.
- JSON이 깨졌거나 schema 검증에 실패하거나 파일명과 내부 `projectId`가 일치하지 않는 recovery 파일은 후보에서 제외한다.
- recovery 폴더 자체를 조회할 수 없으면 editor로 바로 진행하지 않고 재시도 안내를 표시한다.

## 최근 프로젝트

최근 프로젝트 정보는 Electron `userData` 아래의 `recent-projects.json`에 저장한다. 각 항목은 `filePath`, `projectId`, 프로젝트 이름, 내부 정렬용 `lastUsedAt`을 가진다.

- 정상적인 프로젝트 열기 또는 저장이 성공하면 해당 프로젝트를 목록 맨 위에 기록한다.
- 최대 5개만 보관한다.
- 같은 `projectId` 또는 Windows에서 정규화했을 때 같은 경로인 항목은 중복을 제거한다.
- 목록은 가장 최근에 사용한 항목부터 표시하며 앱을 다시 실행해도 유지된다.
- 최근 목록을 통해 열 수 있는 경로는 저장소에 이미 등록된 `.cssproj` 절대 경로로 제한된다.
- 파일이 없어졌다면 해당 항목만 목록에서 제거하고 안내한다.
- 파일 부재 외의 읽기 오류는 항목을 자동 삭제하지 않는다.
- 최근 목록 조회 실패는 editor 진입을 막지 않는다. 저장 파일의 JSON 또는 schema가 잘못된 경우에는 빈 목록으로 처리한다.

Recovery 시작 확인이 최근 프로젝트 UI보다 우선한다.

## 잘못된 프로젝트 파일

일반 Open은 JSON 파싱과 `ProjectDocumentV1` schema 검증을 모두 통과해야 한다. malformed JSON, 잘못된 schema 또는 파일 읽기 실패가 발생하면 다음 안내를 표시한다.

> 프로젝트를 열지 못했습니다. 유효한 .cssproj 파일인지 확인해 주세요.

Open 실패 시 기존 프로젝트 내용, `filePath`, `dirty`, `lastSavedAt`은 유지된다. 이후 정상 `.cssproj`를 열면 오류 안내가 사라지고 정상 프로젝트로 전환된다. Open 대화상자 취소는 오류로 처리하지 않는다.

## Windows package 검증

1. 실행 중인 이 저장소의 `electron-forge start`, Electron, 관련 Node worker가 모두 종료됐는지 확인한다. 실행 중인 개발 프로세스는 `.webpack` 파일을 잠가 package를 방해할 수 있다.
2. 저장소 루트에서 다음 명령을 실행한다.

   ```powershell
   npm test -- --passWithNoTests
   npm run typecheck
   npm run lint
   npm run package
   ```

3. `out\Combark Shorts Studio-win32-x64\Combark Shorts Studio.exe`와 `resources\app.asar`가 새로 생성됐는지 수정 시각을 확인한다.
4. 개발용 `npm start`가 아니라 새로 생성한 `Combark Shorts Studio.exe`로 새 프로젝트, Save, Save As, 정상·잘못된 파일 Open, recovery, 최근 프로젝트 흐름을 검증한다.

## 제한과 주의사항

- 현재 v1은 Windows 전용이며 프로젝트 schema는 버전 1만 지원한다.
- Recovery는 30초 주기의 비상 사본이므로 마지막 recovery 이후의 변경까지 보장하는 실시간 백업이 아니다.
- 복구 프로젝트에는 원래 파일 경로가 연결되지 않으므로 저장할 위치를 다시 선택해야 한다.
- 최근 프로젝트는 파일을 이동하거나 삭제한 사실을 시작 시 미리 검사하지 않는다. 사용자가 해당 항목을 열 때 파일 부재를 확인하고 목록에서 제거한다.
- `.cssproj`, recovery, 최근 프로젝트 저장소를 앱 밖에서 직접 편집하면 검증 실패나 데이터 손상이 발생할 수 있다.
- Renderer는 파일시스템이나 Electron IPC를 직접 사용하지 않고 preload에 공개된 타입 지정 API를 통해 main process에 작업을 요청한다.
