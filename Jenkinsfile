pipeline {
    agent any
    tools {
        nodejs 'node20'  
    }
    environment {
        DOCKER_IMAGE = 'nestjs-master-back-end' // lowercase only
        DOCKER_REGISTRY = 'localhost:5000'
        VERSION = '2.6.12-taku1'
        BRANCH_NAME = ''
        QUALITY_GATE_STATUS = ''
        EMAILS = credentials('email-3') //List of eamil to get notification when build finsished
        SONAR_ISSUE = '0'
        SONAR_HOTSPOT = '0'
        TRIVY_SUMMARY = '0'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    BRANCH_NAME = env.GIT_BRANCH?.replaceFirst(/^origin\//, '') ?: env.BRANCH_NAME
                    echo "[INFO] Triggered by branch: ${BRANCH_NAME}"
                }
            }
        }

        stage('Build and Push Docker Image') {
            steps {
            script {
                def fullImageTag = "${DOCKER_REGISTRY}/${DOCKER_IMAGE}:${VERSION}"
                def imageName = "${DOCKER_IMAGE}"
                def imageTag = "${VERSION}"

                withCredentials([usernamePassword(
                    credentialsId: 'private-registry-1',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    // Use curl to check if image exists in private registry
                    def imageExists = sh(
                        script: """
                            curl -s -f -u "$DOCKER_USER:$DOCKER_PASS" \\
                            -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \\
                            http://host.local:5000/v2/${imageName}/manifests/${imageTag} >/dev/null && echo yes || echo no
                        """,
                        returnStdout: true
                    ).trim()

                    if (imageExists == 'yes') 
                    {
                        echo "[INFO] Image ${fullImageTag} already exists in registry. Skipping build."
                    } 
                    else 
                    {
                    echo "[INFO] Image not found. Building and pushing..."
                    sh """
                        docker build -t ${DOCKER_IMAGE}:${VERSION} --platform linux/amd64 .
                        docker tag ${DOCKER_IMAGE}:${VERSION} ${fullImageTag}
                        docker push ${fullImageTag}
                    """
                    }
                }
            }
            }
        }


        stage('Deploy Container') {
            when {
                expression { return BRANCH_NAME == 'sit' || BRANCH_NAME == 'uat' || BRANCH_NAME == 'main' }
            }
            steps {
                script {
                    def fullImageTag = "${DOCKER_REGISTRY}/${DOCKER_IMAGE}:${VERSION}"

                    if (BRANCH_NAME == 'sit') {
                        withCredentials([file(credentialsId: "nestjs-master-back-end.sit", variable: 'DOTENV_FILE')]) {
                            def envFlags = sh(
                                        script: '''
                                            cat "$DOTENV_FILE" | grep -v '^#' | grep '=' | tr -d '\\r' | xargs -n1 | awk '{print "-e", $0}' | tr '\\n' ' '
                                        ''',
                                        returnStdout: true
                                    ).trim()
                            sh """
                                echo "[INFO] SSH: Running new container with:"
                                echo "docker run -d --name '${DOCKER_IMAGE}' -p 4001:4001 \\\\"
                                echo "    --restart always --network=backend-net \\\\"
                                echo "    ${envFlags} \\\\"
                                echo "    -v /etc/localtime:/etc/localtime:ro ${fullImageTag}"
                                docker rm -f ${DOCKER_IMAGE} || true
                                docker run -d --name "${DOCKER_IMAGE}" -p 4001:4001 \\
                                    --restart always \\
                                    --network=backend-net \\
                                    ${envFlags} \\
                                    "${fullImageTag}"
                            """
                        }
                    } else {
                            def envCredentialId = (BRANCH_NAME == 'uat') ? "nestjs-master-back-end.uat" : "nestjs-master-back-end.prod"
                            withCredentials([file(credentialsId: envCredentialId, variable: 'DOTENV_FILE')]) {

                                def envFlags = sh(
                                    script: '''
                                        cat "$DOTENV_FILE" | grep -v '^#' | grep '=' | tr -d '\\r' | xargs -n1 | awk '{print "-e", $0}' | tr '\\n' ' '
                                    ''',
                                    returnStdout: true
                                ).trim()


                                echo "[DEBUG] Parsed envFlags: ${envFlags}"

                                sh """
                                    ssh autodeploy@host.local -p 2222 -i /var/jenkins_home/.ssh/id_rsa \\
                                    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null bash -c '

                                        imageExists=\$(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^${fullImageTag}\$' || true)
                                        if [ -z "\$imageExists" ]; then
                                            echo "Image not found locally. Pulling..."
                                            docker pull ${fullImageTag}
                                        else
                                            echo "Image exists. Skipping pulling."
                                        fi

                                        docker rm -f "${DOCKER_IMAGE}" 2>/dev/null || true

                                        echo "[INFO] SSH: Running new container with:"
                                        echo "docker run -d --name '${DOCKER_IMAGE}' -p 4001:4001 \\\\"
                                        echo "    --restart always --network=backend-net \\\\"
                                        echo "    ${envFlags} \\\\"
                                        echo "    -v /etc/localtime:/etc/localtime:ro ${fullImageTag}"
                                        docker run -d --name "${DOCKER_IMAGE}" -p 4001:4001 \\
                                            --restart always \\
                                            --network=backend-net \\
                                            ${envFlags} \\
                                            -v /etc/localtime:/etc/localtime:ro \\
                                            "${fullImageTag}"
                                    '
                                """
                            }
                        }
                    }
                }
            }
        }
    post {
        success {
            script {
                def status = 'SUCCESS'
                def emoji = '✅'

                echo "Sending email via emailext ${EMAILS}"
                echo "Build result: ${status}"

                emailext(
                    subject: "TPA-Upgrad: [${status}] ${DOCKER_IMAGE}:${VERSION} ${BRANCH_NAME}#${env.BUILD_NUMBER}",
                    body: """
${emoji} Build ${status}!

• Project     : ${env.JOB_NAME}
• Build       : #${env.BUILD_NUMBER}
• Branch      : ${BRANCH_NAME}
• Version     : ${VERSION}
• Docker Image: ${DOCKER_IMAGE}:${VERSION}
• Sonar Issues       : ${SONAR_ISSUE}
• Sonar Hotspots     : ${SONAR_HOTSPOT}
• Trivy Vulnerabilities: ${TRIVY_SUMMARY}

View console: ${env.BUILD_URL}console

Attachments:
- sonar_issue.json
- sonar_hotspot.json
- trivy-report.json
                            """,
                    attachmentsPattern: 'sonar_issue.json,sonar_hotspot.json,trivy-report.json',
                    from: 'info.tpa@pims.co.th',
                    to: EMAILS,
                    mimeType: 'text/plain'
                )
            }
        }

        failure {
            script {
                def status = 'FAILURE'
                def emoji = '❌'

                echo "Sending email via emailext ${EMAILS}"
                echo "Build result: ${status}"

                emailext(
                    subject: "TPA-Upgrad: [${status}] ${DOCKER_IMAGE}:${VERSION} ${BRANCH_NAME}#${env.BUILD_NUMBER}",
                    body: """
${emoji} Build ${status}!

• Project     : ${env.JOB_NAME}
• Build       : #${env.BUILD_NUMBER}
• Branch      : ${BRANCH_NAME}
• Version     : ${VERSION}
• Docker Image: ${DOCKER_IMAGE}:${VERSION}
• Sonar Issues       : ${SONAR_ISSUE}
• Sonar Hotspots     : ${SONAR_HOTSPOT}
• Trivy Vulnerabilities: ${TRIVY_SUMMARY}

View console: ${env.BUILD_URL}console

Attachments:
- sonar_issue.json
- sonar_hotspot.json
- trivy-report.json
                            """,
                    attachmentsPattern: 'sonar_issue.json,sonar_hotspot.json,trivy-report.json',
                    from: 'info.tpa@pims.co.th',
                    to: EMAILS,
                    mimeType: 'text/plain'
                )
            }
        }
    }
}
