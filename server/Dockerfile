# Build stage: compiles the whole multi-module project and produces a fat jar for :server.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY . .
RUN ./gradlew :server:buildFatJar --no-daemon

# Run stage: just the JRE and the fat jar, nothing else.
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/server/build/libs/server.jar ./server.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "server.jar"]
