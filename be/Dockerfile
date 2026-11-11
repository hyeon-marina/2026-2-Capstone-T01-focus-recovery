# syntax=docker/dockerfile:1

# ---- build ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
ARG COLLECTION_SOURCE_COMMIT=NOT_RECORDED

# 의존성 레이어 캐시: 빌드 스크립트만 먼저 복사해 의존성을 받아 둔다
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon > /dev/null

COPY src src
RUN ./gradlew bootJar -x test --no-daemon \
    && cp build/libs/*-SNAPSHOT.jar app.jar

# ---- runtime ----
FROM eclipse-temurin:21-jre
WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app
COPY --from=build /workspace/app.jar app.jar
USER app

# DB_URL, DB_USERNAME, DB_PASSWORD, AI_BASE_URL은 실행 시 환경 변수로 주입한다
ENV TZ=UTC \
    JAVA_OPTS="-XX:MaxRAMPercentage=75"
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
