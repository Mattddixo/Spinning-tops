// A small, complete spec for trying SpecPage before any source is set up. It
// is saved as a pasted spec, so it needs no connection, upload or admin step.
// Written to show the features readers see: tags, parameters, request and
// response examples, auth and error responses (it scores 100 on the Quality tab).
export const SAMPLE_SPEC = `openapi: 3.0.3
info:
  title: Pet Store (sample)
  version: 1.0.0
  description: |
    A sample API that comes with SpecPage. Replace it with your own spec
    from an attachment, a Git repository, a URL or by pasting it here.
  contact:
    name: API team
    email: api@example.com
servers:
  - url: https://petstore.example.com/v1
    description: Example server (not a real API)
security:
  - bearerAuth: []
tags:
  - name: pets
    description: Add, find and remove pets
  - name: orders
    description: Orders placed in the store
paths:
  /pets:
    get:
      tags: [pets]
      summary: List pets
      description: Returns pets, newest first. Use the status filter to show only available pets.
      operationId: listPets
      parameters:
        - name: status
          in: query
          description: Only return pets with this status
          schema: { $ref: '#/components/schemas/PetStatus' }
        - name: limit
          in: query
          description: How many pets to return (1 to 100)
          schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
      responses:
        '200':
          description: A page of pets
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Pet' }
              example:
                - { id: 42, name: Rex, species: dog, status: available }
                - { id: 43, name: Tom, species: cat, status: sold }
        '401': { $ref: '#/components/responses/Unauthorized' }
    post:
      tags: [pets]
      summary: Add a pet
      description: Adds a pet to the store. New pets are available straight away.
      operationId: addPet
      requestBody:
        required: true
        description: The pet to add
        content:
          application/json:
            schema: { $ref: '#/components/schemas/NewPet' }
            example: { name: Rex, species: dog }
      responses:
        '201':
          description: The pet was added
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
              example: { id: 42, name: Rex, species: dog, status: available }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
  /pets/{petId}:
    parameters:
      - name: petId
        in: path
        required: true
        description: The pet's ID
        schema: { type: integer, format: int64 }
        example: 42
    get:
      tags: [pets]
      summary: Get a pet
      description: Returns one pet by its ID.
      operationId: getPet
      responses:
        '200':
          description: The pet
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
              example: { id: 42, name: Rex, species: dog, status: available }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      tags: [pets]
      summary: Remove a pet
      description: Removes a pet from the store. This can't be undone.
      operationId: deletePet
      responses:
        '204':
          description: The pet was removed
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
  /orders:
    post:
      tags: [orders]
      summary: Place an order
      description: Orders a pet. The pet's status changes to pending until the order is delivered.
      operationId: placeOrder
      requestBody:
        required: true
        description: The pet to order and how many
        content:
          application/json:
            schema: { $ref: '#/components/schemas/NewOrder' }
            example: { petId: 42, quantity: 1 }
      responses:
        '201':
          description: The order was placed
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
              example: { id: 7, petId: 42, quantity: 1, status: placed, placedAt: '2026-01-15T10:30:00Z' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: An access token for the Pet Store API
  responses:
    BadRequest:
      description: The request wasn't valid
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
          example: { code: invalid_request, message: name is required }
    Unauthorized:
      description: The access token is missing or expired
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
          example: { code: unauthorized, message: Sign in again }
    NotFound:
      description: There's no pet with that ID
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
          example: { code: not_found, message: No pet with ID 42 }
  schemas:
    PetStatus:
      type: string
      description: Where the pet is in the sales process
      enum: [available, pending, sold]
    NewPet:
      type: object
      description: The details needed to add a pet
      required: [name, species]
      properties:
        name: { type: string, description: The pet's name, example: Rex }
        species: { type: string, description: 'Kind of animal, such as dog or cat', example: dog }
    Pet:
      description: A pet in the store
      allOf:
        - $ref: '#/components/schemas/NewPet'
        - type: object
          required: [id, status]
          properties:
            id: { type: integer, format: int64, description: The pet's ID, readOnly: true, example: 42 }
            status: { $ref: '#/components/schemas/PetStatus' }
    NewOrder:
      type: object
      description: The details needed to place an order
      required: [petId]
      properties:
        petId: { type: integer, format: int64, description: The pet to order, example: 42 }
        quantity: { type: integer, minimum: 1, default: 1, description: How many to order }
    Order:
      description: An order placed in the store
      allOf:
        - $ref: '#/components/schemas/NewOrder'
        - type: object
          required: [id, status, placedAt]
          properties:
            id: { type: integer, format: int64, description: The order's ID, readOnly: true, example: 7 }
            status: { type: string, description: Where the order is, enum: [placed, delivered] }
            placedAt: { type: string, format: date-time, description: When the order was placed }
    Error:
      type: object
      description: What went wrong
      required: [code, message]
      properties:
        code: { type: string, description: A short code you can check in your code, example: not_found }
        message: { type: string, description: A message you can show to people, example: No pet with ID 42 }
`;
